import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { hasDb } from "@/lib/db/client";
import { MAX_TEXT, record, stats, failures, type PromptEntry } from "@/lib/db/prompts";

/**
 * The prompt log's front door.
 *
 * POST writes one sentence and what became of it. GET reads the shape of the
 * traffic, and the sentences that failed.
 *
 * SIGNED-OUT SENTENCES ARE LOGGED TOO, with a null user. The parser does not
 * care who typed it, and the sentences from someone trying cipher for the
 * first time are the most valuable ones there are — they are the only
 * unrehearsed traffic the product will ever see.
 *
 * NOTHING HERE CAN BREAK A TRADE. The client posts with keepalive and ignores
 * the answer; this route swallows its own errors and returns 200 regardless,
 * because a logging failure that surfaces as a red message in the prompt bar
 * would be the tail wagging the dog.
 */

export const dynamic = "force-dynamic";

/*
 * cipher: in-memory, per instance, resets on deploy — the same shape as the
 * compile route's limiter and for the same reason. It is a spend cap on a
 * public endpoint, not a security boundary. A shared counter in Postgres is
 * the upgrade when there is more than one box.
 */
const LIMIT = 60;
const WINDOW_MS = 60_000;
const hits = new Map<string, number[]>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5_000) {
    for (const [k, v] of hits) if (v.every((t) => now - t > WINDOW_MS)) hits.delete(k);
  }
  return recent.length > LIMIT;
}

const READERS = new Set(["grammar", "model", "none"]);
const OUTCOMES = new Set(["executed", "asked", "refused", "failed"]);

export async function POST(request: Request) {
  if (!hasDb()) return NextResponse.json({ ok: false });

  const session = await getSession(request).catch(() => null);
  const who = session?.userId ?? request.headers.get("x-forwarded-for") ?? "anon";
  if (rateLimited(who)) return NextResponse.json({ ok: false });

  try {
    const body = (await request.json()) as Partial<PromptEntry>;
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text || text.length > MAX_TEXT) return NextResponse.json({ ok: false });

    /* Every field the client sends is checked here. It is a public endpoint:
       `reader` and `outcome` are closed sets, and anything else that is not a
       string of a sane length is dropped rather than stored. */
    const entry: PromptEntry = {
      userId: session?.userId ?? null,
      at: Date.now(),
      text,
      reader: READERS.has(body.reader as string) ? (body.reader as PromptEntry["reader"]) : "none",
      provider: str(body.provider, 20),
      kind: str(body.kind, 20) ?? "unknown",
      reason: str(body.reason, 200),
      spec: body.spec && typeof body.spec === "object" ? body.spec : undefined,
      outcome: OUTCOMES.has(body.outcome as string) ? (body.outcome as PromptEntry["outcome"]) : "failed",
      market: str(body.market, 64),
      ms: typeof body.ms === "number" && body.ms >= 0 && body.ms < 120_000 ? Math.round(body.ms) : null,
    };
    await record(entry);
  } catch (e) {
    console.error("[cipher] prompt log:", e);
  }
  return NextResponse.json({ ok: true });
}

function str(v: unknown, max: number): string | null {
  return typeof v === "string" && v.length > 0 ? v.slice(0, max) : null;
}

/**
 * What the traffic looks like, and what failed.
 *
 * Signed in only: it is not secret, but it is cipher's own operating data and
 * a public endpoint that counts every user's sentences is a scraper magnet.
 */
export async function GET(request: Request) {
  if (!hasDb()) return NextResponse.json({ error: "no database" }, { status: 503 });
  const session = await getSession(request).catch(() => null);
  if (!session) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const q = new URL(request.url).searchParams;
  const days = Math.min(Math.max(Number(q.get("days")) || 30, 1), 365);
  try {
    const [shape, worst] = await Promise.all([stats(days), failures(50)]);
    return NextResponse.json({ days, ...shape, failures: worst });
  } catch (e) {
    console.error("[cipher] prompt stats:", e);
    return NextResponse.json({ error: "unavailable" }, { status: 502 });
  }
}
