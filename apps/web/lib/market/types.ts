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

/**
 * Chart intervals the UI offers.
 *
 * A closed union, not a string, because these map to a specific
 * (timeframe, aggregate) pair upstream — GeckoTerminal has no "4h" endpoint,
 * it has "hour" aggregated by 4. Letting a component pass an arbitrary string
 * would push that translation into the UI.
 */
export type Interval = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

/** One executed swap in the pool. The tape. */
export interface Trade {
  /** Upstream id — stable, so it doubles as the React key. */
  id: string;
  /** Unix seconds. */
  time: number;
  side: "buy" | "sell";
  priceUsd: number;
  volumeUsd: number;
  /** The trader. Truncated for display, kept whole for the explorer link. */
  wallet: string;
  txHash: string;
}

/**
 * One row in the discovery rail.
 *
 * Deliberately NOT TokenStats. A rail row is a pool the user has not chosen
 * yet — it needs the mint to navigate to and enough numbers to decide, but
 * none of the depth the token page fetches. Reusing TokenStats here would
 * force every list endpoint to fill fields no list can supply.
 */
export interface PoolSummary {
  pairAddress: string;
  /** Base token mint — the id /trade/[mint] routes on. */
  mint: string;
  symbol: string;
  dex: string;
  priceUsd: number;
  /** Null means the source did not report the window — not that price was flat. */
  change1h: number | null;
  change24h: number | null;
  volume24h: number;
  liquidityUsd: number;
  /** Unix seconds. Null when the source does not report pool age. */
  createdAt: number | null;
}
