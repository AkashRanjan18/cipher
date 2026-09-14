import { newId } from "@cipher/shared";
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
  /**
   * WHICH COIN. The mint, never the symbol.
   *
   * A fill without this was only ever readable because the ledger held one
   * asset. Anyone can mint a token called SOL for a couple of dollars, so the
   * symbol is a display string and the mint is the identity — the same rule
   * the trigger engine already keys on.
   */
  mint: string;
  side: "buy" | "sell";
  /** Units of the token. */
  qty: number;
  /** USD per unit, after spread. */
  price: number;
  feeUsd: number;
  /** Realised P&L booked by this fill. Always 0 on a buy. */
  realisedUsd: number;
  squawk: string;
  source: "ticket" | "sana";
}

export interface Position {
  /** Units held. */
  qty: number;
  /**
   * Weighted average cost per unit, USD, INCLUDING the fee paid to acquire
   * it. See execute() for why the fee belongs in here.
   */
  costBasis: number;
}

export interface Account {
  usdc: number;
  /**
   * WHAT IS HELD, KEYED BY MINT. Absent means flat; there is no zero row.
   *
   * This was `sol: number` and `costBasis: number` — one shelf — and it is
   * the reason cipher could list every coin on Solana and trade exactly one
   * of them. Every ticket outside SOL was disabled by a guard that existed
   * only because a buy would otherwise have credited `sol` whatever the user
   * clicked: pay for Bitcoin, receive Solana.
   *
   * A record rather than an array because every operation here is a lookup by
   * mint, and an array would make each one a scan and each write a splice.
   */
  positions: Record<string, Position>;
  /** Booked P&L from closed size, across every market. Does not move with the market. */
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
    positions: {},
    realisedUsd: 0,
    feesUsd: 0,
    fills: [],
    depositedUsd: depositUsd,
  };
}

const FLAT: Position = { qty: 0, costBasis: 0 };

/**
 * What is held in one market. Flat when nothing is.
 *
 * Every read goes through here rather than touching `positions` directly, so
 * "no row" and "zero" are the same answer everywhere. The alternative is a
 * dozen call sites each remembering `?? { qty: 0, costBasis: 0 }`, and the
 * one that forgets throws on a market the user has never traded.
 */
export function positionOf(a: Account, mint: string): Position {
  return a.positions[mint] ?? FLAT;
}

/** Every market with something in it. */
export function heldMints(a: Account): string[] {
  return Object.keys(a.positions);
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
 * Price impact: what YOUR order does to the price, as distinct from the
 * spread, which is what the venue charges everyone.
 *
 * A first-order approximation — trade 1% of the resting depth and move the
 * price roughly 1%. The real curve is convex and gets much worse past a few
 * percent of the book, so this UNDERSTATES large orders; it is here because
 * the previous model understated them by charging a flat 10bps whether you
 * bought fifty dollars or five hundred thousand.
 *
 * cipher: replaced by a real quote when aggregator routing lands. A router
 * returns the actual expected output for the actual size across the actual
 * pools, and no local model beats that.
 */
export function impactBps(notionalUsd: number, depthUsd: number | null): number {
  if (!depthUsd || depthUsd <= 0 || notionalUsd <= 0) return 0;
  // Capped: past a third of the book this model stops meaning anything, and
  // an uncapped figure would print slippage of several hundred percent.
  return Math.min(5_000, (notionalUsd / depthUsd) * 10_000);
}

/**
 * The price you actually get, which is never the price on the chart.
 *
 * cipher: a flat spread. The real number comes from route depth — a $50 order
 * and a $500,000 order do not cross the same book — and lands with aggregator
 * quoting in phase 1. A flat 10bps is honest about the direction of the error
 * without inventing a depth model we do not have.
 */
export function fillPrice(mark: number, side: "buy" | "sell", extraBps = 0): number {
  const bps = SPREAD_BPS + Math.max(0, extraBps);
  return side === "buy" ? mark * (1 + bps / 10_000) : mark * (1 - bps / 10_000);
}

/**
 * The price with the commission already inside it.
 *
 * The UI does not itemise fees anywhere, so every price it shows has to be
 * this one: quantity times all-in price is exactly the cash that moved.
 * Quoting the raw fill price beside a balance that also moved by the fee
 * leaves a gap the user can see and cannot explain, which is worse than
 * either showing the fee or hiding it properly.
 *
 * Takes a Quote or a Fill — both carry the four fields it needs.
 */
export function allInPrice(t: {
  side: "buy" | "sell";
  qty: number;
  price: number;
  feeUsd: number;
}): number {
  if (!(t.qty > 0)) return t.price;
  const notional = t.qty * t.price;
  return (t.side === "buy" ? notional + t.feeUsd : notional - t.feeUsd) / t.qty;
}

/**
 * Total account value, marked at live prices.
 *
 * MARKS ARE PER MINT, and a missing one is skipped rather than treated as
 * zero. A price feed that has not answered yet is not a position worth
 * nothing; writing it down as zero would show someone their balance
 * collapsing every time a request was slow, which is the single most alarming
 * thing a trading screen can do.
 */
export function equity(a: Account, marks: Record<string, number>): number {
  let total = a.usdc;
  for (const [mint, p] of Object.entries(a.positions)) {
    const mark = marks[mint];
    if (mark === undefined || !Number.isFinite(mark)) continue;
    total += p.qty * mark;
  }
  return total;
}

/** P&L on one open position. Moves every tick; nothing is booked until a sell. */
export function unrealised(a: Account, mint: string, mark: number): number {
  const p = positionOf(a, mint);
  return p.qty < DUST ? 0 : p.qty * (mark - p.costBasis);
}

/** P&L across every open position, for the marks that are known. */
export function unrealisedTotal(a: Account, marks: Record<string, number>): number {
  let total = 0;
  for (const [mint, p] of Object.entries(a.positions)) {
    const mark = marks[mint];
    if (mark === undefined || !Number.isFinite(mark) || p.qty < DUST) continue;
    total += p.qty * (mark - p.costBasis);
  }
  return total;
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
  mint: string,
  mark: number,
): number | null {
  const px = fillPrice(mark, side);
  switch (amount.kind) {
    case "usd":
      return amount.value / px;
    case "tokens":
      return amount.value;
    case "percentOfPosition":
      /* A percentage of THIS market's position. Reading the whole account
         would sell a third of the wrong coin the moment a second one is
         held. */
      return side === "sell" ? (positionOf(a, mint).qty * amount.value) / 100 : null;
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
  /** How far THIS order moves the price, in bps. 0 when depth is unknown. */
  impactBps: number;
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
export function quote(
  a: Account,
  mint: string,
  side: "buy" | "sell",
  qty: number,
  mark: number,
  /*
   * Execution conditions, plus what to call the thing in a refusal.
   *
   * `symbol` exists only for the sentences. The refusals used to say "SOL"
   * because there was nothing else to say; telling someone they hold no SOL
   * when they are trying to sell BONK is worse than saying nothing.
   */
  opts?: { depthUsd?: number | null; slippageBps?: number; symbol?: string },
): Quote {
  const gross = qty * mark;
  const impact = impactBps(gross, opts?.depthUsd ?? null);
  const price = fillPrice(mark, side, impact);
  const notionalUsd = qty * price;
  const feeUsd = feeFor(notionalUsd);
  const cashUsd = side === "buy" ? notionalUsd + feeUsd : notionalUsd - feeUsd;

  let refusal: string | null = null;

  /*
   * Tolerance, checked BEFORE affordability.
   *
   * A trade that would breach slippage does not happen, so telling the user
   * they cannot afford it is answering a question that no longer applies —
   * and it sends them to top up their balance to fix a problem that is about
   * order size against a thin book.
   */
  const tolerance = opts?.slippageBps;
  if (tolerance !== undefined && impact > tolerance) {
    refusal =
      `That size moves the price about ${(impact / 100).toFixed(2)}% and your limit is ` +
      `${(tolerance / 100).toFixed(2)}%. Trade smaller, or raise the tolerance in settings.`;
  } else if (!Number.isFinite(qty) || qty <= 0) {
    refusal = "That is not an amount.";
  } else if (side === "buy" && cashUsd > a.usdc) {
    refusal = `That needs $${cashUsd.toFixed(2)} with the fee and you have $${a.usdc.toFixed(2)}.`;
  } else if (side === "sell" && qty > positionOf(a, mint).qty + DUST) {
    const held = positionOf(a, mint).qty;
    const unit = opts?.symbol ?? "of it";
    refusal =
      held < DUST
        ? `You hold no ${opts?.symbol ?? "position"} to sell.`
        : `You hold ${held.toFixed(4)} ${unit} and that sells ${qty.toFixed(4)}.`;
  } else if (side === "sell" && notionalUsd <= feeUsd) {
    /* A sale smaller than its own fee is not a trade, it is a donation. The
       $0.95 floor puts anything under about a dollar here. */
    refusal = `The fee on that is $${feeUsd.toFixed(2)} and the sale is only $${notionalUsd.toFixed(2)}.`;
  }

  return { side, qty, price, notionalUsd, feeUsd, cashUsd, impactBps: impact, refusal };
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
    /** WHICH COIN. Required — there is no default market any more. */
    mint: string;
    side: "buy" | "sell";
    qty: number;
    mark: number;
    ts: number;
    squawk?: string;
    source?: Fill["source"];
    /** For refusal sentences only. Never an identity. */
    symbol?: string;
    /* Execution conditions, same shape quote() takes. Threaded rather than
       re-derived, so the price the user approved is the price they get. */
    depthUsd?: number | null;
    slippageBps?: number;
  },
): { account: Account; fill: Fill } | { refusal: string } {
  const q = quote(a, input.mint, input.side, input.qty, input.mark, {
    depthUsd: input.depthUsd,
    slippageBps: input.slippageBps,
    symbol: input.symbol,
  });
  if (q.refusal) return { refusal: q.refusal };

  const next: Account = { ...a, fills: [...a.fills], positions: { ...a.positions } };
  next.feesUsd = a.feesUsd + q.feeUsd;

  const held = positionOf(a, input.mint);
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
    next.positions[input.mint] = {
      qty: held.qty + q.qty,
      costBasis: (held.costBasis * held.qty + cost) / (held.qty + q.qty),
    };
    next.usdc = a.usdc - cost;
  } else {
    /*
     * Average cost, so a partial sale books its share of the basis and the
     * rest of the position keeps the same per-unit cost. FIFO lots change the
     * tax answer but not the P&L, and nobody reading a trading screen is
     * reasoning in lots.
     */
    const proceeds = q.notionalUsd - q.feeUsd;
    realisedUsd = proceeds - q.qty * held.costBasis;
    const left = held.qty - q.qty;
    next.positions[input.mint] = { qty: left, costBasis: held.costBasis };
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
    if (left < DUST || left * q.price < CRUMB_USD) {
      realisedUsd -= left * held.costBasis;
      next.realisedUsd = a.realisedUsd + realisedUsd;
      /*
       * DELETED, not zeroed. A flat position is an absent one — otherwise the
       * account accumulates a zero row for every coin ever touched, and
       * anything iterating positions (equity, the holdings list, the worker's
       * "is this flat" check) walks a list that only ever grows.
       */
      delete next.positions[input.mint];
    }
  }

  const fill: Fill = {
    /*
     * NOT DERIVED FROM fills.length. The worker loads an account WITHOUT its
     * fills to save a query, so that length is always 0 there — and two rungs
     * of a ladder firing in the same second produced the same id twice. The
     * database then dropped the second row while the balance had already
     * moved: money gone with no record of why.
     */
    id: newId("f"),
    ts: input.ts,
    mint: input.mint,
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
