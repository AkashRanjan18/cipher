import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { askModels } from "@/lib/compiler/llm";
import { SYSTEM, userTurn } from "@/lib/compiler/prompt";

/**
 * The model fallback. Which models, and in what order, is lib/compiler/llm.ts.
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

export async function POST(request: Request) {
  const session = await getSession(request);
  if (!session) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }

  if (rateLimited(session.userId)) {
    return NextResponse.json({ error: "too many requests" }, { status: 429 });
  }

  let body: {
    text?: unknown;
    symbol?: unknown;
    label?: unknown;
    interval?: unknown;
    hasPosition?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text || text.length > MAX_CHARS) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const outcome = await askModels(
    SYSTEM,
    userTurn(text, {
      symbol: typeof body.symbol === "string" ? body.symbol : "SOL",
      label: typeof body.label === "string" ? body.label.slice(0, 20) : undefined,
      interval: typeof body.interval === "string" ? body.interval : "1h",
      hasPosition: body.hasPosition === true,
    }),
  );

  if (!outcome.ok) {
    /*
     * No key: not an error — a capability that is not connected, and the
     * client says so in a sentence. Every provider failed: the grammar's
     * refusal stands, which is cipher with a smaller vocabulary, not broken.
     */
    return outcome.reason === "unconfigured"
      ? NextResponse.json({ error: "model not configured" }, { status: 503 })
      : NextResponse.json({ error: "compile failed" }, { status: 502 });
  }
  return NextResponse.json(outcome.compiled);
}
