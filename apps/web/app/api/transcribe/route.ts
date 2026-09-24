import { NextResponse } from "next/server";

/**
 * Spoken order → text, via Deepgram.
 *
 * THE ONLY ENGINE. Chrome's Web Speech API used to run alongside and was
 * removed on 24 Sep 2026 — it has never heard of BONK and writes "bunk", it
 * shipped the audio to Google, and its silent fallback meant nobody could tell
 * which engine had answered. Deepgram, told which words to expect, gets the
 * coin right, and the only thing a trading prompt cannot survive is the right
 * grammar applied to the wrong one.
 *
 * SERVER-SIDE BECAUSE OF THE KEY. A Deepgram key in the browser is readable
 * by anyone who opens DevTools, and a leaked speech key gets found and drained.
 * This route is the only code that ever sees it.
 *
 * PRE-RECORDED, AND THAT IS THE LATENCY. This argued that a four-second clip
 * is over before a socket would finish handshaking, and it was right about the
 * handshake and wrong about the cost. Nothing can start until the speaker
 * stops, so the whole clip crosses the network and is processed in a wait the
 * user sits through — about a second, all of it after they have finished
 * talking. The streaming socket removes that by doing the work WHILE they
 * talk, and the ~1.8x per minute ($0.0077 against $0.0043) buys the only thing
 * that matters here.
 *
 * It needs a Deepgram key with `keys:write` so the server can mint a
 * short-lived browser token; the current key has neither that nor grant
 * permission. Until then this route is as fast as it can be made: on the edge,
 * with the connection warmed while the microphone is open.
 *
 * cipher: no rate limit. Anyone can POST audio here and spend the credit. The
 * size cap below bounds any single request, not the number of them — put a
 * per-IP limit in front of this before it matters, which is when the credit
 * is real money rather than a $200 signup grant.
 */

export const dynamic = "force-dynamic";

const DEEPGRAM = "https://api.deepgram.com/v1/listen";

/*
 * 2MB. A four-second Opus clip is ~20KB and even a rambling thirty-second
 * order is well under 300KB, so this is two orders of magnitude of headroom —
 * and a hard ceiling on what one request can cost.
 */
const MAX_BYTES = 2 * 1024 * 1024;

/*
 * Words the model should expect whatever coin is on screen.
 *
 * Biasing is the whole point of paying for this over the free recogniser.
 * Generic speech models have heard "bank" a million times and "BONK" almost
 * never, so without a hint they pick the common word every time. The trading
 * vocabulary is fixed and small; the coin names arrive per request from the
 * client, because only the client knows what the user is looking at.
 */
const VOCABULARY = [
  "Solana",
  "SOL",
  "USDC",
  "BTC",
  "ETH",
  "slippage",
  "trailing stop",
  "stop loss",
  "take profit",
  "priority fee",
  "Jito",
  "turbo",
  "limit",
  "market cap",
];

/*
 * A ceiling on keyterms. Deepgram bounds how many it will weight, and the
 * useful ones are the coins actually on screen — a long tail of every token
 * on the chain dilutes the hint rather than strengthening it.
 */
const MAX_KEYTERMS = 60;

/**
 * The edge, not a Node function.
 *
 * A Node serverless function runs in one region — iad1 by default, Virginia —
 * so a trader in Mumbai uploads their audio across an ocean before anything
 * begins, and a cold start adds a few hundred milliseconds on top. On the edge
 * the browser's connection terminates at the nearest point of presence, the
 * handshake is local, and there is no cold start to pay.
 *
 * The long leg to Deepgram remains, and it is why this is a step rather than
 * the answer. The answer is the streaming socket.
 */
export const runtime = "edge";

export async function POST(request: Request) {
  const key = process.env.DEEPGRAM_API_KEY;
  /* 503 rather than 500: nothing is broken, the feature is switched off. The
     client treats any failure as "use what the browser already heard". */
  if (!key) return NextResponse.json({ error: "transcription not configured" }, { status: 503 });

  const audio = await request.arrayBuffer();
  if (audio.byteLength === 0) return NextResponse.json({ error: "no audio" }, { status: 400 });
  if (audio.byteLength > MAX_BYTES) return NextResponse.json({ error: "clip too long" }, { status: 413 });

  /*
   * Coin names from the client, sanitised hard. They go into a query string
   * sent to a third party, so anything that is not a plausible ticker or name
   * is dropped rather than escaped and hoped for.
   */
  const asked = new URL(request.url).searchParams.get("keyterms") ?? "";
  const coins = asked
    .split(",")
    .map((t) => t.trim())
    .filter((t) => /^[A-Za-z0-9 .$-]{1,32}$/.test(t));

  const terms = [...new Set([...coins, ...VOCABULARY])].slice(0, MAX_KEYTERMS);

  /*
   * PLAIN WORDS. NO FORMATTING. This is the most important block in the file.
   *
   * With smart_format and numerals on, Deepgram hears perfectly and then
   * rewrites the sentence for a human reader — and a human reader is not who
   * consumes it. Tested on real synthesised audio of "sell half at two x, and
   * stop the rest at minus fifty percent":
   *
   *   formatted:  "sell 0.5 at 2 x, and stop the rest at minus 50%."
   *     -> sell 100% at 2x, and the stop-loss is DROPPED ENTIRELY
   *   plain:      the same words the browser recogniser produces
   *     -> sell 50% at 2x, stop the rest at -50%
   *
   * "half" became "0.5", which reads as half of ONE coin rather than half the
   * position. The user asked for a protected position and would have got their
   * whole bag sold at 2x with no stop at all — a valid, parseable, WRONG order,
   * which is the worst failure this product has.
   *
   * The grammar and normalise.ts were built against the browser recogniser,
   * which returns words. So this returns words too, and number handling stays
   * in the one place that is tested for it. Punctuation is off for the same
   * reason: a trailing period is one more thing to strip.
   */
  const params = new URLSearchParams({
    model: "nova-3",
    language: "en",
    smart_format: "false",
    punctuate: "false",
    numerals: "false",
  });
  for (const t of terms) params.append("keyterm", t);

  /*
   * TIMED, so the round trip can be taken apart.
   *
   * The bar reports one number and it hides two very different costs: the
   * network trip from a browser in India to a function in Virginia and back,
   * and Deepgram's own processing. Optimising the wrong one wastes a day —
   * a faster vendor does nothing about 300ms of ocean, and a nearer region
   * does nothing about a slow model. This is the split.
   */
  const began = Date.now();

  try {
    const res = await fetch(`${DEEPGRAM}?${params}`, {
      method: "POST",
      headers: {
        Authorization: `Token ${key}`,
        /* Passed through untouched: Chrome records webm/opus, Safari mp4/aac,
           and Deepgram reads both. Guessing a type would be worse than
           forwarding the one the browser actually produced. */
        "Content-Type": request.headers.get("content-type") || "audio/webm",
      },
      body: audio,
      /* Nothing falls back any more — the browser's recogniser is gone — so a
         timeout costs the whole sentence rather than some accuracy. Worth
         waiting through a slow answer instead of discarding words somebody
         already said. */
      signal: AbortSignal.timeout(12_000),
    });

    if (!res.ok) {
      console.error("[cipher] deepgram", res.status, await res.text().catch(() => ""));
      return NextResponse.json({ error: "transcription failed" }, { status: 502 });
    }

    const body = (await res.json()) as {
      results?: { channels?: { alternatives?: { transcript?: string; confidence?: number }[] }[] };
    };
    const alt = body.results?.channels?.[0]?.alternatives?.[0];

    return NextResponse.json({
      transcript: (alt?.transcript ?? "").trim(),
      /* Kept for a confidence threshold that does not exist yet, and free to
         carry. There is nothing to fall back TO any more, so it would gate a
         refusal rather than a second opinion. */
      confidence: alt?.confidence ?? null,
      /** Deepgram's share of the wait, in ms. The rest is the network. */
      vendorMs: Date.now() - began,
    });
  } catch (e) {
    console.error("[cipher] deepgram unreachable:", e);
    return NextResponse.json({ error: "transcription unreachable" }, { status: 502 });
  }
}

/**
 * Nothing to serve — this exists to open the connection.
 *
 * The client calls it the moment the microphone opens, so DNS, TCP and TLS
 * are already paid for by the time there is a clip to send. Around 300ms from
 * Mumbai, spent while somebody is still talking rather than while they wait.
 */
export function HEAD() {
  return new Response(null, { status: 204 });
}
