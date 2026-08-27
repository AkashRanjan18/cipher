/**
 * Round-trip scanner — core types.
 *
 * The scanner answers one question: how much did this wallet leave on the
 * table by not selling? That number is the entire growth hook, so the
 * computation lives here, pure and testable, with no network in the path.
 */

export type Side = "buy" | "sell";

/** One swap, normalised from whatever the chain indexer gave us. */
export interface Trade {
  mint: string;
  ts: number; // unix seconds
  side: Side;
  /** token units moved (not lamports, not raw) */
  amount: number;
  /** USD value of the whole leg at the time of the trade */
  usdValue: number;
}

/** A single point on a token's price history, in USD. */
export interface PricePoint {
  ts: number;
  price: number;
}

/** A contiguous window where the wallet held a non-zero balance. */
export interface HoldingWindow {
  start: number;
  end: number; // Infinity-safe: caller passes `now` for still-open positions
  balance: number;
}

export interface StopCounterfactual {
  /** trailing stop distance from the running high-water mark, e.g. 0.4 = -40% */
  distance: number;
  /** when the stop would have fired, or null if it never would have */
  firedAt: number | null;
  /** price the stop would have exited at */
  exitPrice: number | null;
  /** total USD the wallet would have walked away with under this rule */
  wouldHaveRealised: number;
  /** wouldHaveRealised - actualOutcome, floored at 0 */
  saved: number;
}

export interface TokenResult {
  mint: string;
  symbol?: string;

  /** USD put in across all buys */
  invested: number;
  /** USD taken out across all sells */
  realised: number;
  /** USD value of whatever is still held, marked at the latest price */
  currentValue: number;

  /**
   * The most the position was ever worth, counting holdings marked to market
   * PLUS proceeds already realised. Selling half at the top should not shrink
   * your peak.
   */
  peakValue: number;
  peakTs: number;

  /** realised + currentValue - invested */
  pnl: number;
  /** peakValue - (realised + currentValue), floored at 0 */
  leftOnTable: number;
  /** peaked at >= 2x cost and ended below cost */
  roundTripped: boolean;

  stop: StopCounterfactual;
}

export interface ScanResult {
  wallet: string;
  scannedAt: number;
  tokensAnalysed: number;
  roundTripCount: number;

  /** headline number — the thing that goes on the share card */
  totalLeftOnTable: number;
  /** what a -40% trailing stop would have preserved across the whole book */
  totalStopWouldHaveSaved: number;

  totalInvested: number;
  totalRealised: number;
  totalPnl: number;

  /** worst offenders first */
  worst: TokenResult[];
}
