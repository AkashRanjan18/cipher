import { NextResponse } from "next/server";
import { hasDb } from "@/lib/db/client";
import { tick } from "@/lib/triggers/worker";

/**
 * The worker's front door. This is the whole point of the database.
 *
 * A rule armed in a browser used to be watched by that browser, which meant
 * closing the tab stopped the stop. `tick()` is what watches instead: it takes
 * one price sample, finds every rule across every user that has crossed, and
 * fires them. Nobody has to be looking at anything.
 *
 * Called on a schedule — a cron every minute — so the rest of cipher can stay
 * serverless and free. That sets the resolution: a rule fires within a minute
 * of its price, not within a second.
 *
 * cipher: minute resolution is honest for majors and wrong for a launch, where
 * a minute is the whole move. The upgrade is a Cloudflare Durable Object
 * holding a live websocket and calling `tick()` on every price — the engine,
 * the seam and the queries do not change, only what invokes them. Doing that
 * now would mean a second deployment target for a product with no users.
 *
 * THE WORK ITSELF IS IN lib/triggers/worker.ts, not here. A route file cannot
 * be imported by the test runner — it pulls in `next/server` and reaches its
 * dependencies through the `@/` alias — so anything living in this file is
 * code that fires other people's stops with no test behind it.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  /*
   * No secret set means the endpoint is open, and an open endpoint that
   * executes trades is not something to ship by accident. Refusing is the
   * safe default; the schedule simply does not run until it is configured.
   */
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function POST(request: Request) {
  return run(request);
}

/** Most cron services only send GET. Same work, same guard. */
export async function GET(request: Request) {
  return run(request);
}

async function run(request: Request) {
  if (!hasDb()) {
    return NextResponse.json({ error: "no database configured" }, { status: 503 });
  }
  if (!authorised(request)) {
    return NextResponse.json({ error: "not authorised" }, { status: 401 });
  }

  try {
    return NextResponse.json({ ok: true, ...(await tick()) });
  } catch (e) {
    console.error("[cipher] tick failed:", e);
    return NextResponse.json({ error: "tick failed" }, { status: 500 });
  }
}
