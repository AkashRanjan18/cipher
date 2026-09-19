import { DEFAULTS, type Amount, type Rule } from "@cipher/shared";
import {
  execute,
  fillPrice,
  positionOf,
  resolveQty,
  type Account,
  type Fill,
} from "../account/paper.ts";

/**
 * What happens when a rule comes due.
 *
 * THE SEAM. Above this line is the trigger engine, which is pure and knows
 * nothing about money; below it is whatever actually trades. Today that is the
 * paper ledger. Later it is a Jupiter route, a minimumOutAmount set from the
 * user's limit price, a simulated transaction, a delegated signature and a
 * Jito bundle — and none of the engine above changes, because the engine never
 * learns what execution is.
 *
 * Keeping the seam this narrow is the whole reason for building against paper
 * money first. It is not a prototype of the real thing; it is the real thing
 * with one function replaced.
 */

/**
 * THREE OUTCOMES, NOT TWO, and the third is the one that matters.
 *
 *   filled  the trade happened.
 *   failed  it should have happened and did not. Worth retrying — a reverted
 *           swap, a dropped transaction, a pool that moved.
 *   moot    it should NOT happen any more. The position is already gone.
 *
 * Collapsing `moot` into `failed` means a stop on a position you closed by
 * hand retries three times and then reports a failure to the user, for a trade
 * that was never owed. The caller cancels a moot rule instead of retrying it.
 */
export type Outcome =
  | { kind: "filled"; account: Account; fill: Fill }
  | { kind: "failed"; reason: string }
  | { kind: "moot"; reason: string }
  /**
   * NOT YET. A sell whose quantity is larger than what is held.
   *
   * Distinct from `failed` because it is not a fault to retry into a terminal
   * state — the user asked for 5 SOL to be sold and holds 3.5, and the rule is
   * that a sell only ever executes in full. It goes back to watching, with its
   * attempts untouched, and fires the moment the holding is back to size.
   */
  | { kind: "hold"; reason: string };

/**
 * Below this, the trade is not worth making.
 *
 * The commission floor is $0.95 under $200 of notional, so a dust exit — the
 * tail of a percentage split, a position closed down to a few cents — would
 * pay a dollar to move fifty. Refusing is the honest answer; charging the
 * floor to sweep dust is the kind of thing users notice once and never forget.
 */
const DUST_USD = 1;

/**
 * THE OTHER HALF OF A LIMIT ORDER.
 *
 * A trigger decides WHEN. On its own that is a delayed market order: the rule
 * fires on the crossing and then fills at whatever the spread gives, which can
 * be worse than the price the user named. Seen in testing — a "limit sell at
 * $101.75" filled at $100.70, a dollar below the number on the card.
 *
 * A real limit order also says AT WHAT PRICE, and on chain that is the swap's
 * `minimumOutAmount`, set from the user's limit rather than from a slippage
 * percentage: the program itself refuses a worse fill, so it fills at-or-better
 * or it reverts. This is that rule, enforced by the ledger instead of by a
 * program, so the paper version behaves the way the real one will.
 *
 * ONLY FOR priceAbsolute, and the exclusion is the point. A stop is a
 * market order by design — "-50%" means get me out, and a stop that refuses to
 * fill because the price kept falling is a stop that does not work in exactly
 * the crash it exists for. Multiples, drawdowns, trailing stops and timed
 * exits all fill at the market. Real venues draw the same line: stop-market
 * versus stop-limit.
 *
 * Returning `failed` rather than `moot` means it retries on the next tick,
 * which is precisely what a resting order on a real book does while the price
 * is on the wrong side: nothing, until it is not.
 */
function worseThanLimit(rule: Rule, price: number, quoted = false): string | null {
  if (rule.trigger.kind !== "priceAbsolute") return null;
  const limit = rule.trigger.value;
  /*
   * A STOP HAS NO FLOOR. The user's rulebook, 19 Sep 2026:
   *
   *   sell stop loss   sells at that price OR BELOW   — no floor
   *   sell target      sells at that price or above   — never below
   *   sell limit       the same as a sell target
   *   buy limit        buys at that price or below    — never above
   *
   * There is no buy stop: the user removed it (19 Sep 2026), and
   * validate.ts refuses a buy priced above the market before it can rest.
   *
   * Which one a price order is comes from where it sits against the price it
   * was measured from: the entry fill for an exit, the market at arm time
   * for a resting order. This function used to treat EVERY price order as a
   * limit — so a stop at $90 that the market gapped through to $89.50 was
   * refused as "below your limit", retried three times and died: the stop
   * failed in exactly the moment it exists for.
   */
  const reference = rule.entryPrice;
  if (reference !== null) {
    const isStop = rule.side === "sell" && limit < reference;
    if (isStop) return null;
  }
  /* A quoted price IS the fill — spread, impact and cipher's fee are already
     inside it. Applying the model's spread on top would charge it twice. */
  const fill = quoted ? price : fillPrice(price, rule.side);
  if (rule.side === "sell" && fill < limit) {
    return `would have filled at $${fill.toFixed(4)}, below your limit of $${limit}`;
  }
  if (rule.side === "buy" && fill > limit) {
    return `would have filled at $${fill.toFixed(4)}, above your limit of $${limit}`;
  }
  return null;
}

/**
 * What this rule would trade right now, before anything is priced.
 *
 * EXTRACTED SO THE WORKER CAN QUOTE THE EXACT SIZE IT IS ABOUT TO TRADE. The
 * alternative was for the worker to recompute "a third of the position"
 * itself, which is two implementations of the one number that decides how much
 * of someone's money moves — and the day they disagree, the quote prices one
 * trade and the ledger books another.
 *
 * Returns the refusals too, because "the position is already closed" is a fact
 * about the size, and finding it out before spending a network call on a quote
 * is free.
 */
export type Plan =
  | {
      kind: "trade";
      side: "buy" | "sell";
      /** Token units. What the ledger will move. */
      qty: number;
      /** Dollars. What a buy would spend, and what a quote should price. */
      usd: number;
    }
  | { kind: "moot"; reason: string }
  | { kind: "failed"; reason: string }
  | { kind: "hold"; reason: string };

/**
 * Room for rounding between what a sell was sized at and what is held.
 *
 * Half a percent. A buy sized in dollars fills at mark × (1 + spread), so
 * "$500 at $90" receives 5.550 SOL where $500 / $90 reads 5.556 — and a stop
 * that demanded the exact 5.556 would never fire, six thousandths short, on
 * the position it exists to protect. Well under any size a person would
 * notice, well over any rounding the ledger can produce.
 */
const SELL_TOLERANCE = 0.005;

/**
 * A percentage of a position, turned into a fixed number of tokens.
 *
 * THE USER'S RULE, 19 Sep 2026: "30% of my SOL" means 30% of the quantity
 * held when the order is placed — 1.5 of 5 — and that number is what the
 * order shows and what it needs. It does not drift as the position changes.
 * Anything already in tokens or dollars passes through untouched.
 */
export function freezeAmount(amount: Amount, basisQty: number): Amount {
  if (amount.kind !== "percentOfPosition") return amount;
  return { kind: "tokens", value: (basisQty * amount.value) / 100 };
}

export function plan(account: Account, rule: Rule, mark: number): Plan {
  /*
   * THE RULE SAYS WHICH WAY.
   *
   * This was hardcoded to "sell" on the reasoning that every rule is an exit.
   * A resting limit BUY — "buy $500 of SOL at $95" — is the same machine
   * watching the same price, and a hardcoded side would have sold into it.
   */
  const side = rule.side;

  /*
   * SIZE, as the rule carries it.
   *
   * Rules armed since 19 Sep carry a fixed token quantity — freezeAmount()
   * turned the user's percentage into one when the order was placed. The
   * worry that used to argue against freezing was selling more than is
   * owned; that cannot happen now, because a sell larger than the holding
   * waits instead of executing. Older rules still carrying a percentage
   * resolve against the holding here, exactly as before.
   */
  const qty = resolveQty(rule.amount, side, account, rule.market, mark);
  if (qty === null) {
    // resolveQty only returns null for a percentage of a position on the buy
    // side. Unreachable today, kept because "unreachable" is a claim about
    // code that changes.
    return { kind: "failed", reason: "could not resolve the size" };
  }

  const held = positionOf(account, rule.market).qty;
  if (side === "sell" && held <= 0) {
    return { kind: "moot", reason: "the position is already closed" };
  }

  /*
   * A SELL EXECUTES IN FULL OR NOT AT ALL.
   *
   * The user's rule, 19 Sep 2026: any sell — stop loss, target or limit —
   * needs the quantity it names, or more, actually held. This used to CLAMP,
   * selling whatever was left when an order asked for more; that quietly turns
   * "sell 5 SOL at $135" into "sell 3.5 SOL at $135", which is not what anyone
   * said. Now a short order waits, and the Positions card says what it needs.
   *
   * Within SELL_TOLERANCE it still sells what is held: that gap is rounding,
   * not a smaller position, and refusing over it would strand a stop.
   *
   * A buy is never held to the position — it is bounded by cash, which the
   * ledger checks itself and reports as a refusal worth retrying.
   */
  if (side === "sell" && held < qty * (1 - SELL_TOLERANCE)) {
    return {
      kind: "hold",
      reason: `needs ${qty.toFixed(6)} and ${held.toFixed(6)} is held`,
    };
  }
  const size = side === "sell" ? Math.min(qty, held) : qty;

  if (size * mark < DUST_USD) {
    return { kind: "moot", reason: "what is left is smaller than the fee to sell it" };
  }

  /*
   * The dollar figure a BUY should be quoted with.
   *
   * `resolveQty` turns "$500" into tokens using the modelled price, so going
   * back through `mark` recovers roughly the dollars the user named. Roughly,
   * not exactly — and the quote fixes that: it spends the dollars and returns
   * the tokens, which is what a real swap does and what the ledger then books.
   */
  return { kind: "trade", side, qty: size, usd: size * mark };
}

export function fireRule(
  account: Account,
  rule: Rule,
  ctx: {
    /** The price that caused the fire. Passed in; nothing here reads a clock or a feed. */
    mark: number;
    /** Unix SECONDS — paper.ts keeps fills in seconds, the engine works in ms. */
    ts: number;
    /** Book depth, for impact. Null when unknown, which is not the same as zero. */
    depthUsd?: number | null;
    /**
     * Tolerance for this fill, in bps.
     *
     * On chain it becomes the swap's minimumOutAmount, set from the user's
     * limit price rather than from a percentage — which is what turns a
     * trigger into a genuine limit order: it fills at-or-better or it reverts.
     */
    slippageBps?: number;
    /**
     * A REAL price for this size, from a real Jupiter route.
     *
     * PASSED IN, NOT FETCHED HERE, and the reason is that this function has
     * two callers of different shapes. The worker is async and quotes first;
     * the browser's local paper account is synchronous and has no network at
     * all. Fetching inside would force both to become async for something only
     * one of them can use.
     *
     * Absent, the ledger falls back to its spread-and-impact model — honest
     * for SOL, an approximation everywhere else, and clearly labelled as one.
     */
    quoted?: { price: number; qty: number; impactBps: number; route: string } | null;
  },
): Outcome {
  const p = plan(account, rule, ctx.mark);
  if (p.kind !== "trade") return p;

  /*
   * THE QUOTE'S OWN SIZE WINS ON A BUY.
   *
   * A dollar-denominated buy spends exactly the dollars and receives whatever
   * the route returns. Booking the modelled token amount against the real
   * price would record a trade that never happened.
   */
  const size = ctx.quoted && p.side === "buy" ? ctx.quoted.qty : p.qty;

  /*
   * THE LIMIT IS CHECKED AGAINST THE QUOTED PRICE when there is one.
   *
   * Checking the model instead checks the wrong number: a limit sell at
   * $101.75 that the model prices at $101.70 and a real route prices at
   * $99.80 must refuse, and only one of those is true.
   */
  const worse = worseThanLimit(rule, ctx.quoted?.price ?? ctx.mark, Boolean(ctx.quoted));
  if (worse) return { kind: "failed", reason: worse };

  const result = execute(account, {
    mint: rule.market,
    side: p.side,
    qty: size,
    quoted: ctx.quoted ?? null,
    mark: ctx.mark,
    ts: ctx.ts,
    squawk: squawkFor(rule),
    source: "sana",
    depthUsd: ctx.depthUsd,
    slippageBps: ctx.slippageBps ?? DEFAULTS.slippageBps,
  });

  if ("refusal" in result) {
    /*
     * The ledger refused. On paper that is almost always the tolerance — the
     * fill would move the price further than the user accepted — which is
     * exactly the on-chain "reverts rather than fills badly" behaviour, and is
     * genuinely worth retrying on the next tick.
     */
    return { kind: "failed", reason: result.refusal };
  }

  return { kind: "filled", account: result.account, fill: result.fill };
}

/**
 * What the fill says it was, in the user's terms.
 *
 * Reads back the rule rather than the mechanics: a user scanning their fills
 * needs to recognise the instruction they gave, not rediscover it from a
 * price. Deliberately terse — the full sentence lives on the rule.
 */
function squawkFor(rule: Rule): string {
  switch (rule.trigger.kind) {
    case "priceMultiple":
      return `take profit at ${rule.trigger.value}x`;
    case "priceAbsolute":
      return `${rule.side === "buy" ? "limit buy" : "limit sell"} at $${rule.trigger.value}`;
    case "drawdownFromEntry":
      return `stop at -${rule.trigger.percent}%`;
    case "trailingStop":
      return `trailing stop, ${rule.trigger.percent}% off the high`;
    case "timeAbsolute":
    case "duration":
      return "timed exit";
  }
}
