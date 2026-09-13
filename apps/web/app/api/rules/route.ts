import { NextResponse } from "next/server";
import { DEFAULT_AUTHORITY_MS, resolve, type Rule } from "@cipher/shared";
import { getSession } from "@/lib/auth/session";
import { hasDb } from "@/lib/db/client";
import { ensureUser, loadAccount } from "@/lib/db/accounts";
import { cancelRule, insertRule, lastBeat, record, rulesFor, transitionsFor } from "@/lib/db/rules";

/**
 * Rules, from the browser's side.
 *
 * The UI used to own them: armed in React, persisted to localStorage, watched
 * by a setInterval in the tab. That made a stop a promise only kept while
 * someone was looking at it. Now the browser ARMS a rule here and reads back
 * what the worker has done with it, and the watching happens in /api/tick
 * whether or not anyone is signed in on any device.
 *
 * Signed-out users keep the old local behaviour — see lib/triggers/store.tsx.
 * That is not a lesser fallback for its own sake: /trade is public, the paper
 * account works without an account, and a rule with no user to own it has
 * nowhere in this table to go.
 */

export const dynamic = "force-dynamic";

/**
 * How stale the heartbeat may get before the UI should stop claiming anything
 * is watched. Three missed minutes is a deploy or an outage, not jitter.
 */
const STALE_MS = 3 * 60_000;

export async function GET(request: Request) {
  const session = await getSession(request);
  if (!session) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  if (!hasDb()) return NextResponse.json({ error: "no database" }, { status: 503 });

  await ensureUser(session.userId);

  const [rules, transitions, account, beat] = await Promise.all([
    rulesFor(session.userId),
    transitionsFor(session.userId),
    loadAccount(session.userId),
    lastBeat(),
  ]);

  /*
   * The deadman's switch, reported rather than promised.
   *
   * Every armed rule implies "this is being watched". When the worker stops,
   * that becomes false silently — and silence is the one thing a user cannot
   * act on. The UI says so instead.
   */
  const watching = beat !== null && Date.now() - beat < STALE_MS;

  return NextResponse.json({ rules, transitions, account, watching, beat });
}

export async function POST(request: Request) {
  const session = await getSession(request);
  if (!session) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  if (!hasDb()) return NextResponse.json({ error: "no database" }, { status: 503 });

  let body: { rules?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  if (!Array.isArray(body.rules) || body.rules.length === 0 || body.rules.length > 20) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  await ensureUser(session.userId);
  const now = Date.now();
  const saved: Rule[] = [];

  for (const raw of body.rules as Rule[]) {
    /*
     * THE SERVER SETS THE EXPIRY, NOT THE CLIENT.
     *
     * Everything else here is the user's instruction and is taken as given —
     * but the expiry is the blast radius, and a client that can set it can set
     * it to a hundred years. Seven days, renewable, as the non-negotiables say.
     */
    const rule: Rule = { ...raw, expiresAt: now + DEFAULT_AUTHORITY_MS };

    /*
     * A bound rule must resolve to a real threshold, or it would sit in the
     * index as a null and never be found by the worker's query. Unbound rules
     * legitimately have none — they are waiting for an entry to fill.
     */
    if (rule.state === "armed" && rule.entryPrice !== null) {
      const r = resolve(rule.trigger, rule.entryPrice, rule.armedAt);
      if (r.kind === "price" && !Number.isFinite(r.at)) continue;
    }

    await insertRule(session.userId, rule);
    saved.push(rule);
  }

  await record(
    session.userId,
    saved.map((r) => ({
      ruleId: r.id,
      from: r.state,
      to: r.state,
      at: now,
      reason: "armed",
    })),
  );

  return NextResponse.json({ ok: true, rules: saved });
}

export async function DELETE(request: Request) {
  const session = await getSession(request);
  if (!session) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  if (!hasDb()) return NextResponse.json({ error: "no database" }, { status: 503 });

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "bad request" }, { status: 400 });

  /*
   * Scoped to the caller in the WHERE clause, not checked first and deleted
   * after. A check-then-act on someone else's row is a race with a worker that
   * might be firing it.
   */
  const cancelled = await cancelRule(session.userId, id);
  if (cancelled) {
    await record(session.userId, [
      {
        ruleId: id,
        from: "armed",
        to: "cancelled",
        at: Date.now(),
        reason: "cancelled by user",
      },
    ]);
  }
  return NextResponse.json({ ok: cancelled });
}
