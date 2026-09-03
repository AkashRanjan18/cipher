/**
 * Market data shapes.
 *
 * Normalised away from whatever the upstream APIs return, so a provider can
 * be swapped without touching a component. Today that is DexScreener for
 * stats and GeckoTerminal for candles — both free and keyless, which is why
 * this works before any signup. Birdeye or Mobula would slot in behind the
 * same types when volume justifies paying.
 */

export interface TokenStats {
  mint: string;
  /** The specific pool these numbers came from. Prices are per-pool. */
  pairAddress: string;
  symbol: string;
  name: string;
  dex: string;
  priceUsd: number;
  /** Null when the token has no circulating supply data — not zero. */
  marketCap: number | null;
  fdv: number | null;
  liquidityUsd: number;
  volume24h: number;
  /** Percent. Negative is a fall. */
  change24h: number;
  buys24h: number;
  sells24h: number;
}

/** One candle. Times are unix seconds. */
export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type Timeframe = "minute" | "hour" | "day";
