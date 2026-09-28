import { DEFAULTS } from "@cipher/shared";
import { execute, fillPrice, positionOf, type Account, type Fill } from "./paper.ts";
import { quoteFill, type QuotedFill } from "../chain/fill.ts";
import { QuoteError } from "../chain/jupiter.ts";
import { fetchPrices } from "../chain/prices.ts";
import { loadAccount, saveFill } from "../db/accounts.ts";
import { cancelExitsOnClose, record } from "../db/rules.ts";

/**
 * A trade placed by a person — the ticket, Sana, the Positions card.
 *
 * IN lib/, NOT IN THE ROUTE. app/api/trade/route.ts is authorisation around
 * this function and nothing else, because a route cannot be imported by the
 * test runner and this is money logic (CLAUDE.md: route files hold
 * authorisation, never logic). It was all in the route until 27 Sep 2026,
 * which is how a paper-money exploit lived there untested.
 *
 * Same paper.ts arithmetic the worker uses — one ledger, one fee schedule, one
 * set of refusals, whether the trade came from a button, a sentence or a stop
 * firing at three in the morning.
 */

export interface TradeInput {
  mint: string;
  side: "buy" | "sell";
  /** Token units. For a buy, sized by the client from the dollars typed. */
  qty: number;
  /** The client's price, used ONLY to turn a buy's qty back into its dollars. */
  mark: number;
  symbol?: string;
  squawk?: string;
  source?: Fill["source"];
  depthUsd?: number | null;
  slippageBps?: number;
}

export type TradeResult =
  | { fill: Fill; account: Account }
  | { refusal: string; account?: Account | null };

export async function placeTrade(
  userId: string,
  input: TradeInput,
  now: number = Date.now(),
): Promise<TradeResult | null> {
  const { mint, side, qty, mark } = input;
  const account = await loadAccount(userId, false);
  if (!account) return null;

  /*
   * NO SERVER PRICE, NO TRADE.
   *
   * This fell back to the ledger's model at the `mark` the browser sent
   * whenever Jupiter had no price for the mint, and the mint is only
   * length-checked. So a made-up 40-character string, a buy at a mark of
   * $0.000001 and a sell at $1 printed unlimited paper money into the ledger
   * every P&L and leaderboard reads from (review, 27 Sep 2026). A real route
   * price is now the only price a person's trade can fill at.
   */
  let quoted: QuotedFill;
  let serverMark: number;
  try {
    const priced = (await fetchPrices([mint], { revalidate: 5 })).get(mint);
    if (!priced || !(priced.usd > 0) || priced.decimals === undefined) {
      return { refusal: "cipher can't price that token right now, so nothing happened." };
    }
    serverMark = priced.usd;
    quoted = await quoteFill({
      mint,
      decimals: priced.decimals,
      side,
      /*
       * A buy spends the DOLLARS THE USER TYPED: the client sized qty from
       * them at its own price, so qty × that price gives them back. Sizing at
       * the server's price instead made "$500" spend $500 × (server/client),
       * and a Max buy was refused whenever the server's price sat a hair
       * higher. The client's number decides only how much is spent — what it
       * fills at is the quote's.
       *
       * AT fillPrice(), NOT the bare mark: the client sized qty with
       * qtyForBudget(usd, fillPrice(mark)), and only the same price turns it
       * back into the same dollars. At the bare mark a $5,000 buy put
       * $4,970.15 in and charged $24.85 — $4,995 spent, $5 left behind
       * (reported live, 28 Sep 2026). "$500 spends $500 in total" is the rule.
       */
      size: side === "buy" ? qty * fillPrice(mark, "buy") : qty,
      mark: serverMark,
      slippageBps: input.slippageBps ?? DEFAULTS.slippageBps,
    });
  } catch (e) {
    /*
     * A trade nobody will route is a trade that does not happen. Falling back
     * to the model would fill against liquidity Jupiter just said is not
     * there — the one case the model is guaranteed to be wrong about.
     */
    return { refusal: e instanceof QuoteError ? e.message : "could not price that trade" };
  }

  const result = execute(account, {
    mint,
    quoted,
    side,
    qty: side === "buy" ? quoted.qty : qty,
    mark: serverMark,
    symbol: input.symbol,
    ts: Math.floor(now / 1000),
    squawk: input.squawk,
    source: input.source ?? "ticket",
    depthUsd: input.depthUsd ?? null,
    slippageBps: input.slippageBps,
  });
  if ("refusal" in result) return { refusal: result.refusal, account };

  /* Only if the balance is still the one this trade was priced against — see
     saveFill. Losing that race means another trade landed first, and this one
     was computed from a balance that no longer exists. */
  if (!(await saveFill(userId, result.account, result.fill, account.usdc))) {
    return {
      refusal: "Another trade landed at the same moment, so this one did nothing. Check your balance and try again.",
      account: await loadAccount(userId, false),
    };
  }

  /* A sell that emptied the position retires the exits still armed on it —
     the same thing the worker does when a rule empties it. */
  if (side === "sell" && positionOf(result.account, mint).qty <= 0) {
    await record(userId, await cancelExitsOnClose(userId, mint, now));
  }
  return { fill: result.fill, account: result.account };
}
