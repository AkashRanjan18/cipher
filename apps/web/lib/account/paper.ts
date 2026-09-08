import type { Amount } from "@cipher/shared";

/**
 * The paper account.
 *
 * A real ledger with imaginary money. Every rule in here is the rule cipher
 * will actually charge and enforce — the commission schedule from CLAUDE.md,
 * a spread on the fill, average cost basis, and a hard refusal to overdraw.
 * Only the funding is fictional.
 *
 * That is the entire point of it. A demo that fills at the mid, charges
 * nothing and lets you sell tokens you do not own teaches habits that lose
 * money the day the relayer is wired up. This one should feel slightly worse
 * than free, because trading is.
 *
 * Pure by construction: no React, no localStorage, no clock beyond what is
 * passed in. The money math is the part that has to be testable without a
 * browser, so it does not get to touch one.
 *
 * cipher: single market, SOL/USDT. Multi-asset means holdings becomes a map
 * keyed by mint and cost basis moves inside it; nothing else here changes.
 */

/** Below this many SOL the position is flat. Floating point never lands on 0. */
const DUST = 1e-9;

/**
 * A remainder worth less than this is a crumb, not a position.
 *
 * Selling in USD means rounding to the cent and converting back to a
 * quantity, which leaves a few millionths of a SOL behind. That remainder is
 * above DUST, so the position never goes flat, the cost basis never resets,
 * and the card claims an open position worth two hundredths of a cent —
 * which can never be closed, because the fee floor to sell it is $0.95.
 *
 * A cent is deliberately far below anything a rounding remainder can reach
 * and far below anything a person would call a position, so this can never
 * swallow size someone meant to keep.
 */
const CRUMB_USD = 0.01;

export interface Fill {
  id: string;
  /** Unix seconds. Passed in, never read from a clock in here. */
  ts: number;
  side: "buy" | "sell";
  /** SOL. */
  qty: number;
  /** USD per SOL, after spread. */
  price: number;
  feeUsd: number;
  /** Realised P&L booked by this fill. Always 0 on a buy. */
  realisedUsd: number;
  squawk: string;
  source: "ticket" | "polly";
}

export interface Account {
  usdc: number;
  sol: number;
  /**
   * Weighted average cost of the SOL held, USD per SOL, INCLUDING the fee
   * paid to acquire it. See execute() for why the fee belongs in here.
   */
  costBasis: number;
  /** Booked P&L from closed size. Does not move with the market. */
  realisedUsd: number;
  /** Everything cipher has charged. Kept separate so it is always visible. */
  feesUsd: number;
  /** Newest last. */
  fills: Fill[];
  /** What was paid in, so return-on-deposit survives any number of trades. */
  depositedUsd: number;
}

export function openAccount(depositUsd: number): Account {
  return {
    usdc: depositUsd,
    sol: 0,
    costBasis: 0,
    realisedUsd: 0,
    feesUsd: 0,
    fills: [],
    depositedUsd: depositUsd,
  };
}

/**
 * The commission, exactly as CLAUDE.md states it: 0.50% with a referral code,
 * floored at $0.95 under 200 USDC.
 *
 * The floor is not greed and the UI should never apologise for it — the
 * priority fee and the Jito tip are fixed per transaction, so under about
 * $190 of notional the percentage does not cover the cost of submitting the
 * trade. Charging it here means a $20 order looks as expensive as it really
 * is (4.75%), which is worth learning on paper rather than live.
 */
export function feeFor(notionalUsd: number): number {
  return notionalUsd < 200 ? 0.95 : notionalUsd * 0.005;
}

/** 10 bps of spread, charged against the trader in both directions. */
const SPREAD_BPS = 10;

/**
 * The price you actually get, which is never the price on the chart.
 *
 * cipher: a flat spread. The real number comes from route depth — a $50 order
 * and a $500,000 order do not cross the same book — and lands with aggregator
 * quoting in phase 1. A flat 10bps is honest about the direction of the error
 * without inventing a depth model we do not have.
 */
export function fillPrice(mark: number, side: "buy" | "sell"): number {
  return side === "buy" ? mark * (1 + SPREAD_BPS / 10_000) : mark * (1 - SPREAD_BPS / 10_000);
}

/** Total account value, marked at the live price. */
export function equity(a: Account, mark: number): number {
  return a.usdc + a.sol * mark;
}

/** P&L on the open position. Moves every tick; nothing is booked until a sell. */
export function unrealised(a: Account, mark: number): number {
  return a.sol < DUST ? 0 : a.sol * (mark - a.costBasis);
}

/**
 * Turn the compiler's Amount into a quantity of SOL.
 *
 * Returns null when the amount cannot mean anything for this side — buying
 * "a third of your position" is not an instruction, it is a misparse, and the
 * caller must refuse rather than pick a number.
 */
export function resolveQty(
  amount: Amount,
  side: "buy" | "sell",
  a: Account,
  mark: number,
): number | null {
  const px = fillPrice(mark, side);
  switch (amount.kind) {
    case "usd":
      return amount.value / px;
    case "tokens":
      return amount.value;
    case "percentOfPosition":
      return side === "sell" ? (a.sol * amount.value) / 100 : null;
  }
}

export interface Quote {
  side: "buy" | "sell";
  qty: number;
  price: number;
  /** qty × price, before fee. */
  notionalUsd: number;
  feeUsd: number;
  /** What leaves the USDC balance on a buy, or lands in it on a sell. */
  cashUsd: number;
  /** Null when the order is executable; a sentence for the user when it is not. */
  refusal: string | null;
}

/**
 * Price an order without executing it, including the reason it would fail.
 *
 * One function, so the preview on the ticket and the actual execution can
 * never disagree. Two code paths for "what will this cost" is how a screen
 * ends up promising one number and charging another.
 */
export function quote(a: Account, side: "buy" | "sell", qty: number, mark: number): Quote {
  const price = fillPrice(mark, side);
  const notionalUsd = qty * price;
  const feeUsd = feeFor(notionalUsd);
  const cashUsd = side === "buy" ? notionalUsd + feeUsd : notionalUsd - feeUsd;

  let refusal: string | null = null;
  if (!Number.isFinite(qty) || qty <= 0) {
    refusal = "That is not an amount.";
  } else if (side === "buy" && cashUsd > a.usdc) {
    refusal = `That needs $${cashUsd.toFixed(2)} with the fee and you have $${a.usdc.toFixed(2)}.`;
  } else if (side === "sell" && qty > a.sol + DUST) {
    refusal =
      a.sol < DUST
        ? "You hold no SOL to sell."
        : `You hold ${a.sol.toFixed(4)} SOL and that sells ${qty.toFixed(4)}.`;
  } else if (side === "sell" && notionalUsd <= feeUsd) {
    /* A sale smaller than its own fee is not a trade, it is a donation. The
       $0.95 floor puts anything under about a dollar here. */
    refusal = `The fee on that is $${feeUsd.toFixed(2)} and the sale is only $${notionalUsd.toFixed(2)}.`;
  }

  return { side, qty, price, notionalUsd, feeUsd, cashUsd, refusal };
}

/**
 * Apply an order. Returns a NEW account — the old one is never mutated, so
 * React sees a changed reference and a failed execute cannot half-corrupt
 * state.
 *
 * Refuses rather than clamps. The scanner clamps oversized sells because a
 * real wallet receives tokens by transfer and the true balance is unknowable;
 * here the balance is known exactly, so quietly filling less than the user
 * asked for would be a lie about what happened.
 */
export function execute(
  a: Account,
  input: {
    side: "buy" | "sell";
    qty: number;
    mark: number;
    ts: number;
    squawk?: string;
    source?: Fill["source"];
  },
): { account: Account; fill: Fill } | { refusal: string } {
  const q = quote(a, input.side, input.qty, input.mark);
  if (q.refusal) return { refusal: q.refusal };

  const next: Account = { ...a, fills: [...a.fills] };
  next.feesUsd = a.feesUsd + q.feeUsd;

  let realisedUsd = 0;

  if (q.side === "buy") {
    /*
     * The fee goes INTO the cost basis rather than sitting beside it.
     *
     * If it did not, a position would open showing exactly $0.00 P&L while
     * the account is already down the commission — the screen would say
     * break-even at a price where selling loses money. Folding it in opens a
     * fresh position slightly red, which is true, and makes the number on the
     * card the price it actually has to reach.
     */
    const cost = q.notionalUsd + q.feeUsd;
    next.costBasis = (a.costBasis * a.sol + cost) / (a.sol + q.qty);
    next.sol = a.sol + q.qty;
    next.usdc = a.usdc - cost;
  } else {
    /*
     * Average cost, so a partial sale books its share of the basis and the
     * rest of the position keeps the same per-unit cost. FIFO lots change the
     * tax answer but not the P&L, and nobody reading a trading screen is
     * reasoning in lots.
     */
    const proceeds = q.notionalUsd - q.feeUsd;
    realisedUsd = proceeds - q.qty * a.costBasis;
    next.sol = a.sol - q.qty;
    next.usdc = a.usdc + proceeds;
    next.realisedUsd = a.realisedUsd + realisedUsd;

    /*
     * Flat resets the basis. Same reason the trailing high-water mark resets
     * in the scanner: carry a stale reference across a round trip and the
     * next position gets measured against a price from the last one.
     *
     * A crumb counts as flat, but its cost is BOOKED rather than forgotten —
     * the user paid for it and can never sell it, so it is a realised loss,
     * not a rounding error to be quietly dropped.
     */
    if (next.sol < DUST || next.sol * q.price < CRUMB_USD) {
      realisedUsd -= next.sol * a.costBasis;
      next.realisedUsd = a.realisedUsd + realisedUsd;
      next.sol = 0;
      next.costBasis = 0;
    }
  }

  const fill: Fill = {
    id: `f${input.ts.toString(36)}${a.fills.length.toString(36)}`,
    ts: input.ts,
    side: q.side,
    qty: q.qty,
    price: q.price,
    feeUsd: q.feeUsd,
    realisedUsd,
    squawk: input.squawk?.trim() ?? "",
    source: input.source ?? "ticket",
  };
  next.fills.push(fill);

  return { account: next, fill };
}

/**
 * The largest buy the balance supports, solved rather than guessed.
 *
 * Spending the whole balance always refuses, because the fee is charged on
 * top of the notional. Above the floor the fee is proportional, so the answer
 * is usdc / 1.005; below it the fee is a flat $0.95 and the answer is
 * usdc − 0.95. Compute the proportional one and fall back when it is not in
 * its own valid range.
 *
 * Rounded DOWN to the cent, which a test insisted on: the exact limit becomes
 * a quantity and then a notional again, and that round trip lands a fraction
 * of a cent over the balance. A Max button that is always refused by floating
 * point is worse than no Max button.
 */
export function maxBuyUsd(a: Account): number {
  const proportional = a.usdc / 1.005;
  const raw = proportional >= 200 ? proportional : a.usdc - 0.95;
  return Math.max(0, Math.floor(raw * 100) / 100);
}
