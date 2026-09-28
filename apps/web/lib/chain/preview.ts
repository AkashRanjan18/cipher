import { USDC_MINT, fromBaseUnits, quote, toBaseUnits } from "./jupiter.ts";

/**
 * What a trade is worth the moment it lands — BEFORE it is placed.
 *
 * The fomo complaint that started this (27 Sep 2026): "$500 of a $4m
 * robinhood token... ending up with only $468". Nothing on the screen said so
 * until after. One real route quote at this size says it before: how many
 * tokens the dollars buy (or dollars the tokens sell for), valued at the
 * market price the position card will use. The gap is the pool's fee plus
 * this size's price impact. No model, no guess.
 *
 * cipher's own 0.5% fee is taken BEFORE this: a buy's size here is the
 * dollars that reach the pool, and the ticket shows the fee beside it.
 *
 * NOT "what you would get selling straight back". That was the first
 * version, and its own test showed why it is wrong: both quotes are taken
 * against the pool as it is now, before the buy has moved it, so the return
 * trip counted the price impact twice and printed a number far below what an
 * immediate sell would really fetch.
 */

const USDC_DECIMALS = 6;

export interface Preview {
  side: "buy" | "sell";
  /** Dollars in (buy) or tokens in (sell). */
  size: number;
  /** Tokens out (buy) or dollars out (sell). */
  out: number;
  /** What the trade's result is worth at the market price, in dollars. */
  worthNowUsd: number;
  /** Loss against the market, as a percentage of what went in. 0 is perfect. */
  costPct: number;
}

export async function preview(req: {
  mint: string;
  decimals: number;
  side: "buy" | "sell";
  /** DOLLARS for a buy (after cipher's fee), token units for a sell. */
  size: number;
  /**
   * The market price, USD per token — FRESH. The route fetches it uncached:
   * through Next's cache it came back stale first and refreshed after, and a
   * $5,000 SOL buy was valued 0.42% low, "worth $4,953.85" for SOL that the
   * same second's price made $4,974.70 (28 Sep 2026).
   *
   * Not a small reference quote instead: that pays the pool's own fee too,
   * and would hide exactly the cost this exists to show.
   */
  mark: number;
  signal?: AbortSignal;
}): Promise<Preview> {
  const { mint, decimals, side, size, mark, signal } = req;

  if (side === "buy") {
    const buy = await quote(
      { inputMint: USDC_MINT, outputMint: mint, amount: toBaseUnits(size, USDC_DECIMALS), slippageBps: 300 },
      signal,
    );
    const tokens = fromBaseUnits(buy.outAmount, decimals);
    const worthNowUsd = tokens * mark;
    return { side, size, out: tokens, worthNowUsd, costPct: pct(size, worthNowUsd) };
  }

  const sell = await quote(
    { inputMint: mint, outputMint: USDC_MINT, amount: toBaseUnits(size, decimals), slippageBps: 300 },
    signal,
  );
  const dollars = fromBaseUnits(sell.outAmount, USDC_DECIMALS);
  /* For a sell the "result" is dollars, and the fair value is the tokens at
     the market price — so the loss is what the route pays short of that. */
  return { side, size, out: dollars, worthNowUsd: dollars, costPct: pct(size * mark, dollars) };
}

/** Percent lost going from `fair` to `got`. Never negative: a quote that
    beats a lagging market price is a price-feed artefact, not a gain. */
function pct(fair: number, got: number): number {
  if (!(fair > 0)) return 0;
  return Math.max(0, (1 - got / fair) * 100);
}
