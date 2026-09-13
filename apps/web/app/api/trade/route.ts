import { NextResponse } from "next/server";
import { execute } from "@/lib/account/paper";
import { getSession } from "@/lib/auth/session";
import { hasDb } from "@/lib/db/client";
import { ensureUser, loadAccount, resetAccount, saveFill } from "@/lib/db/accounts";

/**
 * A trade, placed by a person rather than by a rule.
 *
 * The ticket and the prompt bar both land here once the account lives in the
 * database. Same paper.ts arithmetic the worker uses — one ledger, one fee
 * schedule, one set of refusals, whether the trade came from a button, a
 * sentence or a stop firing at three in the morning.
 *
 * THE SERVER IS THE ONLY WRITER. The browser stopped keeping its own balance
 * the moment a worker could change it: two writers and last-one-wins means a
 * stop that fires while you are mid-order silently loses to whichever finished
 * second.
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await getSession(request);
  if (!session) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  if (!hasDb()) return NextResponse.json({ error: "no database" }, { status: 503 });

  let body: {
    side?: unknown;
    qty?: unknown;
    mark?: unknown;
    squawk?: unknown;
    source?: unknown;
    depthUsd?: unknown;
    slippageBps?: unknown;
    reset?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  await ensureUser(session.userId);

  if (body.reset === true) {
    await resetAccount(session.userId);
    return NextResponse.json({ account: await loadAccount(session.userId) });
  }

  const side = body.side === "buy" || body.side === "sell" ? body.side : null;
  const qty = typeof body.qty === "number" ? body.qty : NaN;
  const mark = typeof body.mark === "number" ? body.mark : NaN;
  if (!side || !(qty > 0) || !(mark > 0)) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const account = await loadAccount(session.userId, false);
  if (!account) return NextResponse.json({ error: "no account" }, { status: 404 });

  const result = execute(account, {
    side,
    qty,
    mark,
    ts: Math.floor(Date.now() / 1000),
    squawk: typeof body.squawk === "string" ? body.squawk : undefined,
    source: body.source === "sana" ? "sana" : "ticket",
    depthUsd: typeof body.depthUsd === "number" ? body.depthUsd : null,
    slippageBps: typeof body.slippageBps === "number" ? body.slippageBps : undefined,
  });

  /*
   * A refusal is a 200, not a 400.
   *
   * "You cannot afford this" is a correct answer to a well-formed request, and
   * the client has a sentence to show for it. Returning an error status would
   * put it down the same path as a network failure, where the message is lost.
   */
  if ("refusal" in result) {
    return NextResponse.json({ refusal: result.refusal, account });
  }

  await saveFill(session.userId, result.account, result.fill);
  return NextResponse.json({ fill: result.fill, account: result.account });
}
