import type { Candle, Interval } from "./types";

/**
 * OHLCV candles from GeckoTerminal. Free, keyless, ~30 requests a minute.
 *
 * Candles are per-POOL, not per-token — which is why fetchTokenStats runs
 * first and hands over the pair address it chose. Charting a different pool
 * from the one the stats came from would show two different prices for the
 * same token on one screen.
 */

const ENDPOINT = "https://api.geckoterminal.com/api/v2/networks/solana/pools";

/**
 * Raw rows are [timestamp, open, high, low, close, volume], newest first.
 * Exported so the mapping can be tested without a network call.
 */
export function toCandles(rows: number[][]): Candle[] {
  return rows
    .map(([time, open, high, low, close, volume]) => ({
      time,
      open,
      high,
      low,
      close,
      volume,
    }))
    /*
     * Chart libraries require ascending time and will either throw or render
     * a scribble on unsorted input. GeckoTerminal returns newest first, so
     * this reversal is not optional.
     */
    .sort((a, b) => a.time - b.time);
}

/*
 * GeckoTerminal has three endpoints — minute, hour, day — and an `aggregate`
 * multiplier. There is no "4h" route; there is "hour" aggregated by 4. This
 * table is the only place that translation lives, so a component asks for
 * "4h" and never learns the upstream shape.
 *
 * Only these multipliers are supported upstream. Asking for hour/aggregate=3
 * returns an empty list, not an error, which would look like a dead token.
 */
const INTERVALS: Record<Interval, { timeframe: string; aggregate: number; seconds: number }> = {
  "1m": { timeframe: "minute", aggregate: 1, seconds: 60 },
  "5m": { timeframe: "minute", aggregate: 5, seconds: 300 },
  "15m": { timeframe: "minute", aggregate: 15, seconds: 900 },
  "1h": { timeframe: "hour", aggregate: 1, seconds: 3600 },
  "4h": { timeframe: "hour", aggregate: 4, seconds: 14400 },
  "1d": { timeframe: "day", aggregate: 1, seconds: 86400 },
};

export const INTERVAL_ORDER: Interval[] = ["1m", "5m", "15m", "1h", "4h", "1d"];

export function isInterval(v: string): v is Interval {
  return v in INTERVALS;
}

export async function fetchCandles(
  pairAddress: string,
  interval: Interval = "1h",
  limit = 300,
): Promise<Candle[]> {
  const { timeframe, aggregate, seconds } = INTERVALS[interval];

  const res = await fetch(
    `${ENDPOINT}/${pairAddress}/ohlcv/${timeframe}?aggregate=${aggregate}&limit=${limit}`,
    {
      headers: { Accept: "application/json" },
      /*
       * Cache for half a candle. Revalidating faster than the candle closes
       * spends the 30 req/min budget re-fetching a bar that has not changed;
       * revalidating slower leaves the live candle visibly stale.
       */
      next: { revalidate: Math.max(10, Math.floor(seconds / 2)) },
    },
  );
  if (!res.ok) return [];

  const data = (await res.json()) as {
    data?: { attributes?: { ohlcv_list?: number[][] } };
  };
  return toCandles(data.data?.attributes?.ohlcv_list ?? []);
}
