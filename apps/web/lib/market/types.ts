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
  /**
   * The same four numbers over four windows. The terminal shows all of them
   * side by side, because a token up 48% on the day and down 0.6% in the last
   * five minutes is a different trade from one still climbing.
   */
  windows: Record<WindowKey, MarketWindow>;
  /** Unix seconds the pool was created. Pool age, not token age. */
  createdAt: number | null;
  /** Token logo. Null when the pool has no metadata attached. */
  imageUrl: string | null;
  socials: Social[];
}

/** The windows every DEX source reports: 5 minutes, 1 hour, 6 hours, 1 day. */
export type WindowKey = "m5" | "h1" | "h6" | "h24";

export interface MarketWindow {
  /** Percent. Null means the source did not report the window, not flat. */
  change: number | null;
  volume: number;
  buys: number;
  sells: number;
}

export interface Social {
  /** "twitter" | "telegram" | "discord" | "website" — kept open, sources vary. */
  type: string;
  url: string;
}

/**
 * The safety picture for one token.
 *
 * On memecoins this is not a nice-to-have panel: a live mint authority means
 * the deployer can print supply into your position, and an unlocked LP means
 * they can withdraw the pool you are trying to sell into. Every competitor
 * shows this, because trading without it is gambling on a stranger.
 */
export interface TokenSecurity {
  /** Null is GOOD here: the authority has been revoked. */
  mintAuthority: string | null;
  freezeAuthority: string | null;
  /** Percent of LP locked or burned. */
  lpLockedPct: number;
  totalHolders: number;
  /** Upstream's own 0-10 rating. Lower is safer. */
  riskScore: number;
  risks: Risk[];
  topHolders: Holder[];
}

export interface Risk {
  name: string;
  description: string;
  /** "warn" | "danger" | "info" — rendered as colour. */
  level: string;
}

export interface Holder {
  address: string;
  /** Share of supply, percent. */
  pct: number;
  /** Upstream believes this wallet is connected to the deployer. */
  insider: boolean;
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

/** One blue-chip row for the sidebar and the bottom ticker. */
export interface Major {
  id: string;
  symbol: string;
  imageUrl: string | null;
  priceUsd: number;
  change24h: number;
  marketCap: number | null;
}

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
