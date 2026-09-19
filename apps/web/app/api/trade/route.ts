import { NextResponse } from "next/server";
import { execute } from "@/lib/account/paper";
import { quoteFill, type QuotedFill } from "@/lib/chain/fill";
import { QuoteError } from "@/lib/chain/jupiter";
import { fetchPrices } from "@/lib/chain/prices";
import { DEFAULTS } from "@cipher/shared";
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
    mint?: unknown;
    symbol?: unknown;
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
  /*
   * The mint is required and validated here rather than defaulted.
   *
   * It is the identity of what the user is buying, arriving from a client, so
   * a missing one is a bad request and not a reason to pick a market on their
   * behalf. Length-checked only — resolution is lib/chain/tokens.ts's job, and
   * the ledger does not care whether a mint exists, only that two different
   * coins never share a row.
   */
  const mint = typeof body.mint === "string" ? body.mint.trim() : "";
  if (!side || !mint || mint.length < 32 || mint.length > 44 || !(qty > 0) || !(mark > 0)) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const account = await loadAccount(session.userId, false);
  if (!account) return NextResponse.json({ error: "no account" }, { status: 404 });

  /*
   * PRICED BY A REAL ROUTE before anything is booked.
   *
   * The ledger's own model charges ten basis points of spread and a
   * first-order impact guess, which is fair for SOL and wrong by percent for a
   * thin pool. This is the same Jupiter endpoint the real swap will use, with
   * the same platformFeeBps, so a paper fill and a signed one differ by the
   * signature and nothing else.
   *
   * Decimals come from the price feed, which is cached and already warm for
   * any market the user can see.
   */
  let quoted: QuotedFill | null = null;
  try {
    const priced = await fetchPrices([mint], { revalidate: 5 });
    const decimals = priced.get(mint)?.decimals;
    if (decimals !== undefined) {
      quoted = await quoteFill({
        mint,
        decimals,
        side,
        size: side === "buy" ? qty * mark : qty,
        mark,
        slippageBps:
          typeof body.slippageBps === "number" ? body.slippageBps : DEFAULTS.slippageBps,
      });
    }
  } catch (e) {
    /*
     * A trade nobody will route is a trade that does not happen. Falling back
     * to the model here would fill against liquidity Jupiter just said is not
     * there — the one case the model is guaranteed to be wrong about.
     */
    const why = e instanceof QuoteError ? e.message : "could not price that trade";
    return NextResponse.json({ refusal: why });
  }

  const result = execute(account, {
    mint,
    quoted,
    side,
    qty: quoted && side === "buy" ? quoted.qty : qty,
    mark,
    symbol: typeof body.symbol === "string" ? body.symbol : undefined,
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
