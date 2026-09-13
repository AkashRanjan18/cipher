import type { Amount, Trigger } from "../order.ts";

/**
 * What an armed rule is, and every state it can be in.
 *
 * Separate from engine.ts for the same reason lib/scanner splits them: these
 * are the shapes that get persisted, versioned and eventually generated into
 * another language. The machine that moves between them is replaceable; this
 * is not.
 */

export const RULE_VERSION = 1;

/**
 * THE STATE MACHINE, AND WHY EACH STATE EARNS ITS PLACE.
 *
 *   unbound   armed before the reference price exists. "Sell half at 2x" is
 *             armed the moment the user approves it, but 2x of WHAT is not
 *             known until the entry fills. A rule here is inert: it is in no
 *             index and cannot fire. Making it a distinct state rather than
 *             an armed rule with a null threshold means a bug that skips
 *             binding fails loudly instead of firing at zero.
 *
 *   armed     in the index, watching. The only state a rule can fire from.
 *
 *   firing    claimed. The engine emits exactly one fire for a rule and moves
 *             it here in the same step, so a second tick a millisecond later
 *             cannot emit a second one. This is the whole of exactly-once on
 *             the engine side.
 *
 *   filled    done, terminal.
 *   cancelled the user revoked it, terminal.
 *   expired   its authority ran out before it fired, terminal. Delegate
 *             authority is 7-day renewable by design, so rules outliving
 *             their permission is normal operation, not an error.
 *   failed    fired, could not execute, out of retries. Terminal and loud.
 */
export type RuleState =
  | "unbound"
  | "armed"
  | "firing"
  | "filled"
  | "cancelled"
  | "expired"
  | "failed";

/** Terminal states never transition again. */
export const TERMINAL: ReadonlySet<RuleState> = new Set<RuleState>([
  "filled",
  "cancelled",
  "expired",
  "failed",
]);

export interface Rule {
  version: typeof RULE_VERSION;
  id: string;
  /** Which market's price this watches, e.g. "SOLUSDT". */
  market: string;
  /**
   * What it does when it fires.
   *
   * Was derived rather than stored, on the reasoning that every rule is an
   * exit. That stopped being true the moment "buy SOL at $95" had to work — a
   * resting BUY is the same machine watching the same price, and deriving the
   * side from "rules are exits" would have made a limit buy sell instead.
   */
  side: "buy" | "sell";
  /**
   * The resting entry this exit is waiting for. Null when there isn't one.
   *
   * WITHOUT THIS, THE FIRST ENTRY TO FILL CLAIMS EVERY WAITING EXIT. Two
   * resting buys — one at $95 with a take-profit, one at $101.70 without —
   * and the $101.70 fill bound the $95 order's exit to its own price. Seen in
   * the alerts panel as a 2x target of $205.56 on an order that had not
   * traded. Exits bind only to the entry that was armed with them.
   */
  parentId: string | null;
  trigger: Trigger;
  amount: Amount;
  state: RuleState;
  /** Epoch ms. */
  armedAt: number;
  /**
   * When the authority behind this rule lapses. Epoch ms.
   *
   * Not optional, and not defaulted to "never". A rule that can fire forever
   * is a delegate authority that never expires, which is the thing your own
   * non-negotiables forbid.
   */
  expiresAt: number;
  /**
   * The entry fill price this rule is relative to. Null until bound.
   *
   * "2x" and "-50%" are both meaningless without it, and it is deliberately
   * the FILL price rather than the price when the sentence was typed — the
   * user's multiple is on what they actually paid.
   */
  entryPrice: number | null;
  /**
   * Highest price seen since binding. Trailing stops only, null otherwise.
   *
   * RESETS WHEN THE POSITION GOES FLAT. Without that, buying back into a
   * token you previously rode to 5x fires the stop on the first tick — the
   * same bug the scanner had, in a place where it costs money.
   */
  highWater: number | null;
  /** How many times execution has been attempted and failed. */
  attempts: number;
}

/**
 * One movement between states, append-only.
 *
 * The engine emits these rather than writing them, which keeps it pure and
 * makes the immutable audit trail a consequence of the design instead of a
 * feature someone has to remember. Persist every one, never update one.
 */
export interface Transition {
  ruleId: string;
  from: RuleState;
  to: RuleState;
  /** Epoch ms. */
  at: number;
  /** Plain English, for the audit log and the alerts panel. */
  reason: string;
  /** The price that caused it, where a price caused it. */
  price?: number;
}

/**
 * What the engine hands back from every call.
 *
 * `fire` is the only thing that touches money, and it is a list rather than a
 * single rule because one tick can cross several thresholds at once — a
 * take-profit ladder is exactly that.
 */
export interface Step {
  state: EngineState;
  /** Rules the caller must now execute. Already moved to "firing". */
  fire: Rule[];
  transitions: Transition[];
}

/**
 * Everything the engine knows.
 *
 * Serialisable on purpose: this is what a worker restores on restart, and
 * what a test can write out by hand.
 *
 * cipher: one engine holds every market. At scale this shards by
 * hash(mint) % N and each shard owns its own slice of `markets` — the index
 * is already per-market, so sharding is a routing change rather than a
 * rewrite. Doing it now would buy nothing and cost clarity.
 */
export interface EngineState {
  rules: Record<string, Rule>;
  markets: Record<string, MarketIndex>;
  /** Rules with a deadline, sorted ascending. Checked on the clock, not on price. */
  deadlines: Slot[];
  /** Every rule's expiry, sorted ascending. Separate from `deadlines`: one is
   *  the user's instruction, the other is the authority behind it. */
  expiries: Slot[];
}

/** A rule's position in a sorted index. */
export interface Slot {
  ruleId: string;
  /** A price, or an epoch-ms timestamp, depending on which index holds it. */
  at: number;
}

/**
 * The sorted price index for one market.
 *
 * THREE LISTS, ALL SCANNED AS PREFIXES. Never iterate every rule on a tick —
 * binary-search the crossing point and take what is before it. A market with
 * ten thousand armed rules costs the same as one with ten until something
 * actually crosses.
 *
 *   above     ascending.  Crossed when price >= at. Everything at or below
 *             the search point has fired.
 *   below     descending. Crossed when price <= at. Same prefix shape,
 *             mirrored, which is why the sort order differs.
 *   trailing  ascending by high-water. A trailing stop's threshold moves, so
 *             it cannot sit still in `below`. This index answers the only
 *             question that matters on a tick: whose high has just been beaten?
 *             Also a prefix, also O(log n).
 */
export interface MarketIndex {
  above: Slot[];
  below: Slot[];
  trailing: Slot[];
}
