import type { Candle } from "./types";

/**
 * Folding a live price into the bar that is currently forming.
 *
 * This is the arithmetic an exchange does on every trade: a price inside the
 * current bucket extends that bar's high, low and close; a price past the
 * boundary opens the next bar. It lives here rather than inside the chart
 * component so it can be tested without a canvas — the chart is a renderer,
 * this is the rule.
 */
export function foldLivePrice(
  last: Candle,
  price: number,
  barSeconds: number,
  nowMs: number = Date.now(),
): Candle {
  const bucket = Math.floor(nowMs / 1000 / barSeconds) * barSeconds;

  /*
   * A bar that has already closed is never rewritten. Without this guard a
   * late tick would reopen a settled candle and silently restate history —
   * the chart would disagree with the exchange about what happened.
   */
  if (bucket > last.time) {
    return {
      time: bucket,
      open: price,
      high: price,
      low: price,
      close: price,
      // Volume is only known at the next server fetch; claiming a number here
      // would invent one.
      volume: 0,
    };
  }

  return {
    ...last,
    high: Math.max(last.high, price),
    low: Math.min(last.low, price),
    close: price,
  };
}
