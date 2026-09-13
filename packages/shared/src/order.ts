/**
 * The order spec.
 *
 * This is the contract every other component speaks: the compiler produces
 * it, the readback renders it, the user approves it, the trigger engine
 * evaluates it, and the executor fills it. Nothing downstream ever sees the
 * original sentence.
 *
 * It lives in packages/shared rather than in apps/web because the trigger
 * engine will be a separate service. If that service ends up in Rust, this
 * file stays the source of truth and the Rust types are generated from it.
 *
 * Versioned from day one. An armed order can outlive several deploys, so a
 * spec written today must still be readable when the shape changes.
 */

export const ORDER_SPEC_VERSION = 1;

/**
 * How much. Kept as a tagged union rather than a bare number because
 * "sell a third" and "sell $500" and "sell 1000 tokens" are three different
 * questions and collapsing them loses the user's actual intent.
 */
export type Amount =
  | { kind: "usd"; value: number }
  | { kind: "tokens"; value: number }
  /** 0-100. Of the position at the moment the rule fires, not at arm time. */
  | { kind: "percentOfPosition"; value: number };

/**
 * What has to happen for a rule to fire.
 *
 * `priceMultiple` and `drawdownFromEntry` are both relative to the FILL price
 * of the entry, which is not known until the entry executes. A rule is armed
 * with the reference unresolved and bound at fill time.
 */
export type Trigger =
  /** 2 = "at 2x". Relative to entry fill. */
  | { kind: "priceMultiple"; value: number }
  /** An absolute price in USD. */
  | { kind: "priceAbsolute"; value: number }
  /** 50 = "stop at -50%". Relative to entry fill. */
  | { kind: "drawdownFromEntry"; percent: number }
  /** 40 = "trail 40% off the high". High-water mark resets if the position goes flat. */
  | { kind: "trailingStop"; percent: number }
  /** Gap-proof: time moves continuously, price does not. */
  | { kind: "timeAbsolute"; iso: string }
  | { kind: "duration"; seconds: number };

export interface ExitRule {
  id: string;
  trigger: Trigger;
  amount: Amount;
}

export interface Entry {
  side: "buy" | "sell";
  /**
   * A resting entry. Null means fill now.
   *
   * "Buy $500 of SOL at $95" is not a market order with a note attached — it
   * is an order that does not exist until the price arrives. On an AMM there
   * is no book to rest it in, so "limit" means the trigger engine watches and
   * fires a market swap when it crosses; what makes it a real limit order
   * rather than a delayed market order is the swap's minimumOutAmount, set
   * FROM THIS PRICE rather than from a slippage percentage. It fills at-or-
   * better or it reverts, and the only failure mode left is "no fill" — which
   * is exactly what a CEX limit does when price never reaches you.
   *
   * Only price triggers make sense here. A time-triggered entry is a scheduled
   * buy, which is a different product decision and is not one cipher has made.
   */
  trigger: Trigger | null;
  /** Whatever the user said — "bonk". Resolved to a mint before arming. */
  token: string;
  /** Set once the token is resolved; null means unresolved. */
  mint: string | null;
  amount: Amount;
  /** 300 = 3%. Defaulted by the compiler when unstated. */
  slippageBps: number;
  /** Jito bundle rather than the public mempool. */
  privateSubmission: boolean;
}

export interface OrderSpec {
  version: typeof ORDER_SPEC_VERSION;
  entry: Entry | null;
  exits: ExitRule[];
  /** Which path produced this — useful for measuring how often the model is needed. */
  source: "grammar" | "model";
  /** Anything understood but not actionable, surfaced in the readback. */
  warnings: string[];
}

/** Defaults applied when the sentence doesn't say. Every one is a decision. */
export const DEFAULTS = {
  /** 3%. Tight enough to refuse a bad fill, loose enough to land on a moving memecoin. */
  slippageBps: 300,
  /** Private by default: the user did not ask to be sandwiched. */
  privateSubmission: true,
} as const;
