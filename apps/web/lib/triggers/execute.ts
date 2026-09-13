import { DEFAULTS, type Rule } from "@cipher/shared";
import { execute, resolveQty, type Account, type Fill } from "../account/paper.ts";

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
  | { kind: "moot"; reason: string };

/**
 * Below this, the trade is not worth making.
 *
 * The commission floor is $0.95 under $200 of notional, so a dust exit — the
 * tail of a percentage split, a position closed down to a few cents — would
 * pay a dollar to move fifty. Refusing is the honest answer; charging the
 * floor to sweep dust is the kind of thing users notice once and never forget.
 */
const DUST_USD = 1;

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
     * cipher: on the paper ledger this refuses a fill whose impact exceeds the
     * tolerance. On chain it becomes the swap's minimumOutAmount, set from the
     * user's limit price rather than from a percentage — which is what turns a
     * trigger into a genuine limit order: it fills at-or-better or it reverts.
     * ExitRule carries no slippage of its own today, so exits take the default
     * the compiler applies to entries.
     */
    slippageBps?: number;
  },
): Outcome {
  /*
   * EXITS ARE SELLS.
   *
   * cipher is spot-long-only: every rule in the system today is an exit from a
   * position the user holds. Shorting arrives with perps, on a venue that
   * holds its own trigger orders and does not come through here at all — so
   * deriving the side rather than storing it costs nothing now and cannot be
   * silently wrong later.
   */
  const side = "sell" as const;

  /*
   * SIZE IS RESOLVED NOW, NOT AT ARM TIME.
   *
   * "Sell a third" means a third of what is held at the moment the rule fires.
   * A quantity frozen when the user approved the sentence would be wrong the
   * first time they topped up or sold by hand — and wrong in the direction of
   * selling more than they own.
   */
  const qty = resolveQty(rule.amount, side, account, ctx.mark);

  if (qty === null) {
    // resolveQty only returns null for a percentage of a position on the buy
    // side, which the `side` constant above rules out. Unreachable today, kept
    // because "unreachable" is a claim about code that changes.
    return { kind: "failed", reason: "could not resolve the size" };
  }

  if (account.sol <= 0) {
    return { kind: "moot", reason: "the position is already closed" };
  }

  /*
   * Clamp rather than refuse.
   *
   * A ladder is a set of percentages of a position that is shrinking as the
   * ladder fills, and rounding across three rungs can ask for a fraction more
   * than is held. Refusing the last rung over a rounding error would leave a
   * user holding dust and an alert saying their take-profit failed.
   */
  const size = Math.min(qty, account.sol);

  if (size * ctx.mark < DUST_USD) {
    return { kind: "moot", reason: "what is left is smaller than the fee to sell it" };
  }

  const result = execute(account, {
    side,
    qty: size,
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
      return `limit at $${rule.trigger.value}`;
    case "drawdownFromEntry":
      return `stop at -${rule.trigger.percent}%`;
    case "trailingStop":
      return `trailing stop, ${rule.trigger.percent}% off the high`;
    case "timeAbsolute":
    case "duration":
      return "timed exit";
  }
}
