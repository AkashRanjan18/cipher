import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { getSession } from "@/lib/auth/session";
import { compiledSchema } from "@/lib/compiler/schema";
import { SYSTEM, userTurn } from "@/lib/compiler/prompt";

/**
 * The model fallback. The ONLY place cipher pays for inference.
 *
 * The grammar handles the sentences people actually type — in under ten
 * milliseconds, with no network and no chance of a misread. This is for the
 * long tail it cannot cover: "dump half my bags if it craps out", "get me out
 * before the weekend". That phrasing space is genuinely open, which is what a
 * model is for.
 *
 * FOUR THINGS MAKE THIS SAFE TO EXPOSE, and all four live here rather than in
 * the client, because the client is a thing anyone can edit:
 *
 *   1. It is server-side, because the API key cannot be in a browser.
 *   2. It requires a session. An unauthenticated endpoint that calls a paid
 *      API is a bill with a public URL.
 *   3. It rate limits per user, because the user decides how many calls you
 *      pay for and some of them will be a script.
 *   4. Whatever comes back is re-validated against the schema here, and then
 *      validated AGAIN as an order on the client. "The provider says it
 *      conforms" is a claim about someone else's service.
 *
 * What it does NOT do is execute anything. It returns an intent. Every path
 * that moves money still goes through validate.ts and a readback the user
 * approves — the model never touches the execution path, which is the rule
 * this whole architecture is built around.
 */

/**
 * Default model.
 *
 * cipher: claude-opus-5 is the default, and this is a small structured
 * extraction from a short sentence — the kind of job claude-haiku-4-5 does
 * for roughly a fifth of the input cost. Set CIPHER_COMPILE_MODEL to switch;
 * that is a spending decision, so it is a setting rather than a hardcode.
 */
const MODEL = process.env.CIPHER_COMPILE_MODEL ?? "claude-opus-5";

/**
 * Low effort, deliberately.
 *
 * Thinking depth buys accuracy on hard reasoning. This is a classification
 * into a closed schema from one sentence; the schema is doing the constraining
 * and extra deliberation buys tokens rather than correctness.
 */
const EFFORT = "low" as const;

/** A sentence. Anything longer is not a trading instruction. */
const MAX_CHARS = 400;

/** Per user, per window. A person types a few a minute; a script does not. */
const LIMIT = 20;
const WINDOW_MS = 60_000;

/*
 * cipher: in-memory, so the limit is per server instance and resets on deploy.
 * That is the right amount of machinery for one box and the wrong amount for
 * three — the upgrade is a shared counter in Redis or Postgres, keyed the same
 * way. It is not a security boundary; it is a spend cap.
 */
const hits = new Map<string, number[]>();

function rateLimited(userId: string): boolean {
  const now = Date.now();
  const recent = (hits.get(userId) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(userId, recent);
  // Cheap sweep so a long-lived instance does not accumulate every user ever.
  if (hits.size > 5_000) {
    for (const [k, v] of hits) if (v.every((t) => now - t > WINDOW_MS)) hits.delete(k);
  }
  return recent.length > LIMIT;
}

let client: Anthropic | null = null;
function anthropic(): Anthropic | null {
  if (client) return client;
  if (!process.env.ANTHROPIC_API_KEY) return null;
  client = new Anthropic();
  return client;
}

export async function POST(request: Request) {
  const session = await getSession(request);
  if (!session) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }

  if (rateLimited(session.userId)) {
    return NextResponse.json({ error: "too many requests" }, { status: 429 });
  }

  let body: { text?: unknown; symbol?: unknown; interval?: unknown; hasPosition?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text || text.length > MAX_CHARS) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const api = anthropic();
  if (!api) {
    /*
     * No key. Not an error — a capability that is not connected, and the
     * client turns this into a sentence the user can act on rather than a
     * stack trace. cipher runs entirely on the grammar without it.
     */
    return NextResponse.json({ error: "model not configured" }, { status: 503 });
  }

  try {
    /* A trader is waiting with a half-typed order. Past about eight seconds the
       answer is worth less than the delay, and the grammar's refusal is already
       on screen. Set on the client rather than per-call: messages.parse takes
       one argument. */
    const response = await api.withOptions({ timeout: 8_000 }).messages.parse(
      {
        model: MODEL,
        max_tokens: 1_024,
        system: [
          {
            type: "text",
            text: SYSTEM,
            /* The prefix is identical on every request and is most of the
               tokens. Caching it is the difference between this costing
               nothing and this costing something. */
            cache_control: { type: "ephemeral" },
          },
        ],
        output_config: {
          effort: EFFORT,
          format: zodOutputFormat(compiledSchema),
        },
        messages: [
          {
            role: "user",
            content: userTurn(text, {
              symbol: typeof body.symbol === "string" ? body.symbol : "SOLUSDT",
              interval: typeof body.interval === "string" ? body.interval : "1h",
              hasPosition: body.hasPosition === true,
            }),
          },
        ],
    });

    /*
     * The model can decline. It is a 200 with stop_reason "refusal", not an
     * exception, so it has to be checked before the content is read — and it
     * becomes an honest refusal rather than a crash.
     */
    if (response.stop_reason === "refusal") {
      return NextResponse.json({
        intent: {
          kind: "refusal",
          reason: "outOfScope",
          message: "I can't help with that one.",
        },
        warnings: [],
      });
    }

    const parsed = response.parsed_output;
    if (!parsed) {
      return NextResponse.json({ error: "unparseable" }, { status: 502 });
    }

    /*
     * Validated again, on our side.
     *
     * The API enforces the schema on the way out. This enforces it on the way
     * in. They are the same schema and the second check is not redundant — it
     * is the difference between trusting a response and trusting a service.
     */
    const safe = compiledSchema.safeParse(parsed);
    if (!safe.success) {
      console.error("[cipher] model returned a shape we do not accept:", safe.error.issues);
      return NextResponse.json({ error: "unparseable" }, { status: 502 });
    }

    return NextResponse.json(safe.data);
  } catch (e) {
    /*
     * A timeout, a rate limit upstream, a bad key. The user gets nothing from
     * this route and the grammar's refusal stands — which is the correct
     * degradation: cipher without the model is cipher with a smaller
     * vocabulary, not cipher that is broken.
     */
    console.error("[cipher] compile failed:", e);
    return NextResponse.json({ error: "compile failed" }, { status: 502 });
  }
}
