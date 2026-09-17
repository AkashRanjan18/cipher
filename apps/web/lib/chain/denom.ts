import type { Candle } from "../market";

/**
 * WHAT THE CHART IS COUNTING IN.
 *
 * CLAUDE.md records a Price/MCap toggle being deleted because it "would have
 * set a label and changed nothing" — there was no supply figure then, so the
 * market-cap option had nothing behind it. There is one now: Jupiter reports
 * `fdv` and `priceUsd` on every token, and their ratio is the total supply.
 * So this is the same control with a real second option underneath it.
 *
 * A UNIT CHANGE, NOT A SECOND SOURCE. Every bar is multiplied by one constant,
 * so the shape of the chart is identical and only the axis moves. That is the
 * honest version: the two views cannot disagree, because there is only one
 * series and one number between them.
 *
 * cipher: supply is treated as constant across history, which it is not for a
 * token that is still minting — an old bar is priced at today's supply. For a
 * mint-disabled token it is exact, and for the rest the error is the supply
 * curve, which no free feed reports per-bar. The moment one does, this
 * function takes a series instead of a scalar and nothing above it changes.
 */
export type Denom = "price" | "mcap";

/** Total units in existence, from the two fields Jupiter always returns. */
export function supplyOf(token: { fdv: number | null; priceUsd: number } | null): number | null {
  if (!token || !token.fdv || !(token.priceUsd > 0)) return null;
  return token.fdv / token.priceUsd;
}

/**
 * The multiplier to put a price series into market-cap terms.
 *
 * One rather than null when there is nothing to scale by: a Binance major has
 * no token behind it and no cap to show, and multiplying by one leaves the
 * chart exactly as it was instead of blanking it.
 */
export function factor(denom: Denom, supply: number | null): number {
  return denom === "mcap" && supply !== null && supply > 0 ? supply : 1;
}

/** Every bar scaled. Returns the same array when there is nothing to do. */
export function scaleCandles(candles: Candle[], by: number): Candle[] {
  if (by === 1) return candles;
  return candles.map((c) => ({
    ...c,
    open: c.open * by,
    high: c.high * by,
    low: c.low * by,
    close: c.close * by,
  }));
}
