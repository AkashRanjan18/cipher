import type { Candle, Timeframe } from "./types";

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

export async function fetchCandles(
  pairAddress: string,
  timeframe: Timeframe = "hour",
  limit = 300,
): Promise<Candle[]> {
  const res = await fetch(
    `${ENDPOINT}/${pairAddress}/ohlcv/${timeframe}?limit=${limit}`,
    { headers: { Accept: "application/json" }, next: { revalidate: 60 } },
  );
  if (!res.ok) return [];

  const data = (await res.json()) as {
    data?: { attributes?: { ohlcv_list?: number[][] } };
  };
  return toCandles(data.data?.attributes?.ohlcv_list ?? []);
}
