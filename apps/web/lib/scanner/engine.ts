import type {
  Trade,
  PricePoint,
  TokenResult,
  ScanResult,
  StopCounterfactual,
} from "./types";

/** Default trailing-stop distance used for the headline counterfactual. */
export const DEFAULT_STOP = 0.4;

/** Below this USD value a position is noise, not a story. */
const DUST = 1;

/**
 * Analyse one token for one wallet.
 *
 * Walks the price series and the trade list together in timestamp order,
 * carrying a running balance. Two things fall out of that walk:
 *
 *   peak   — the best mark-to-market the position ever reached while held.
 *            Using balance-at-t rather than holding windows means re-entries
 *            are handled correctly for free.
 *
 *   stop   — what a trailing stop would have done. The high-water mark resets
 *            whenever the balance returns to zero, so a fresh position gets a
 *            fresh stop rather than inheriting the last one's peak.
 */
export function analyseToken(
  mint: string,
  trades: Trade[],
  prices: PricePoint[],
  now: number,
  stopDistance: number = DEFAULT_STOP,
  symbol?: string,
): TokenResult | null {
  if (trades.length === 0 || prices.length === 0) return null;

  const tx = [...trades].sort((a, b) => a.ts - b.ts);
  const px = [...prices].sort((a, b) => a.ts - b.ts);

  let balance = 0;
  let invested = 0;
  let realised = 0;

  let peakValue = 0;
  let peakTs = px[0].ts;

  // trailing-stop simulation state
  let hwm = 0;
  let realisedAtStop = 0;
  let stopFiredAt: number | null = null;
  let stopExitPrice: number | null = null;
  let stopBalance = 0;

  let t = 0;

  for (const point of px) {
    // apply every trade at or before this price point
    while (t < tx.length && tx[t].ts <= point.ts) {
      const trade = tx[t];
      if (trade.side === "buy") {
        balance += trade.amount;
        invested += trade.usdValue;
      } else {
        // clamp: a sell larger than known balance means tokens arrived by a
        // transfer we never saw. Count the proceeds, don't go negative.
        balance = Math.max(0, balance - trade.amount);
        realised += trade.usdValue;
      }
      if (balance === 0) hwm = 0; // flat — reset the stop
      t++;
    }

    if (balance <= 0) continue;

    // Peak is holdings PLUS everything already taken out. Marking holdings
    // alone punishes someone who sold half at the top — their remaining bag
    // shrinks but the cash they banked is still part of what the position
    // was worth at that moment.
    const mark = balance * point.price + realised;
    if (mark > peakValue) {
      peakValue = mark;
      peakTs = point.ts;
    }

    if (stopFiredAt === null) {
      if (point.price > hwm) hwm = point.price;
      if (hwm > 0 && point.price <= hwm * (1 - stopDistance)) {
        stopFiredAt = point.ts;
        stopExitPrice = point.price;
        stopBalance = balance;
        realisedAtStop = realised;
      }
    }
  }

  // any trades after the last price point
  while (t < tx.length) {
    const trade = tx[t];
    if (trade.side === "buy") {
      balance += trade.amount;
      invested += trade.usdValue;
    } else {
      balance = Math.max(0, balance - trade.amount);
      realised += trade.usdValue;
    }
    t++;
  }

  const lastPrice = px[px.length - 1].price;
  const currentValue = balance * lastPrice;
  const outcome = realised + currentValue;

  if (peakValue < outcome) peakValue = outcome;

  const wouldHaveRealised =
    stopFiredAt !== null && stopExitPrice !== null
      ? realisedAtStop + stopBalance * stopExitPrice
      : outcome;

  const stop: StopCounterfactual = {
    distance: stopDistance,
    firedAt: stopFiredAt,
    exitPrice: stopExitPrice,
    wouldHaveRealised,
    saved: Math.max(0, wouldHaveRealised - outcome),
  };

  return {
    mint,
    symbol,
    invested,
    realised,
    currentValue,
    peakValue,
    peakTs,
    pnl: outcome - invested,
    leftOnTable: Math.max(0, peakValue - outcome),
    roundTripped: peakValue >= invested * 2 && outcome < invested,
    stop,
  };
}

export interface TokenInput {
  mint: string;
  symbol?: string;
  trades: Trade[];
  prices: PricePoint[];
}

/** Roll every token up into the numbers that go on the share card. */
export function scan(
  wallet: string,
  tokens: TokenInput[],
  now: number = Math.floor(Date.now() / 1000),
  stopDistance: number = DEFAULT_STOP,
): ScanResult {
  const results: TokenResult[] = [];

  for (const t of tokens) {
    const r = analyseToken(t.mint, t.trades, t.prices, now, stopDistance, t.symbol);
    if (r && r.invested >= DUST) results.push(r);
  }

  const sum = (f: (r: TokenResult) => number) =>
    results.reduce((acc, r) => acc + f(r), 0);

  return {
    wallet,
    scannedAt: now,
    tokensAnalysed: results.length,
    roundTripCount: results.filter((r) => r.roundTripped).length,
    totalLeftOnTable: sum((r) => r.leftOnTable),
    totalStopWouldHaveSaved: sum((r) => r.stop.saved),
    totalInvested: sum((r) => r.invested),
    totalRealised: sum((r) => r.realised),
    totalPnl: sum((r) => r.pnl),
    worst: [...results].sort((a, b) => b.leftOnTable - a.leftOnTable).slice(0, 10),
  };
}
