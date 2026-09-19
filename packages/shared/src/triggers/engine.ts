import type { Amount, ExitRule, Trigger } from "../order.ts";
import {
  RULE_VERSION,
  TERMINAL,
  type EngineState,
  type MarketIndex,
  type Rule,
  type RuleState,
  type Slot,
  type Step,
  type Transition,
} from "./types.ts";

/**
 * The thing that watches.
 *
 * Nothing in cipher watches a price. The grammar parses "sell a third at 2x,
 * stop the rest at -50%" perfectly and then the UI admits nothing is
 * listening. This is the machine that listens — and it is one machine, not
 * four: resting limit orders, stops, take-profit ladders and Sana's exits are
 * the same state machine with different thresholds.
 *
 * PURE. No React, no network, no clock of its own, no storage. Every function
 * takes state and an event and returns new state plus what the caller should
 * do about it. That is not fastidiousness — it is what lets the same file run
 * against the paper account in a browser today and inside a server worker
 * against real swaps later, with the call at the bottom swapped and everything
 * above it untouched.
 *
 * Time is always passed in. A module that reads Date.now() cannot be tested
 * for a rule that expires in seven days without waiting seven days.
 */

/** How many execution failures before a rule is given up on. */
const MAX_ATTEMPTS = 3;

/** Delegate authority is 7-day renewable — see the non-negotiables. */
export const DEFAULT_AUTHORITY_MS = 7 * 24 * 60 * 60 * 1000;

export function emptyEngine(): EngineState {
  return { rules: {}, markets: {}, deadlines: [], expiries: [] };
}

/* ────────────────────────────── thresholds ─────────────────────────────── */

/**
 * Where a trigger sits, once there is a price to measure it against.
 *
 * `price` triggers become a number and a direction; `time` triggers become a
 * deadline. Returning a tagged result rather than two nullable fields means
 * the caller cannot forget one — the switch below has no default branch, so
 * adding a member to the Trigger union breaks this file until it is handled.
 */
export type Resolved =
  | { kind: "price"; at: number; direction: "above" | "below" }
  | { kind: "time"; at: number };

export function resolve(trigger: Trigger, entryPrice: number, boundAt: number): Resolved {
  switch (trigger.kind) {
    case "priceMultiple":
      /*
       * DIRECTION IS DERIVED, NOT ASSUMED.
       *
       * "Take profit at 2x" is obviously upward, but the grammar accepts any
       * positive multiple on purpose — it parses what was said and lets
       * validate.ts judge it. "At 0.8x" is a downside target, and hardcoding
       * "multiples fire on the way up" would arm it above the entry where it
       * can never be reached, silently.
       */
      return price(entryPrice * trigger.value, entryPrice);

    case "priceAbsolute":
      return price(trigger.value, entryPrice);

    case "drawdownFromEntry":
      // Always downward: a drawdown that fires on the way up is not a stop.
      return { kind: "price", at: entryPrice * (1 - trigger.percent / 100), direction: "below" };

    case "trailingStop":
      // Measured from the high-water mark, which starts at the entry and only
      // ever rises. The caller re-resolves this as new highs are made.
      return { kind: "price", at: entryPrice * (1 - trigger.percent / 100), direction: "below" };

    case "timeAbsolute":
      return { kind: "time", at: Date.parse(trigger.iso) };

    case "duration":
      return { kind: "time", at: boundAt + trigger.seconds * 1000 };
  }
}

function price(at: number, reference: number): Resolved {
  // A threshold above where we started is reached by rising, one below it by
  // falling. Equal counts as "above" so a rule at exactly the entry fires on
  // the next tick rather than never.
  return { kind: "price", at, direction: at >= reference ? "above" : "below" };
}

/* ───────────────────────────── sorted indexes ──────────────────────────── */

/**
 * Insert keeping the array sorted, by binary search rather than sort().
 *
 * Arming is far rarer than ticking, but re-sorting a ten-thousand-entry array
 * on every new rule is the kind of thing that is invisible at ten rules and
 * fatal at ten thousand, and it costs four lines to not do.
 */
function insert(list: Slot[], slot: Slot, ascending: boolean): void {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const before = ascending ? list[mid].at <= slot.at : list[mid].at >= slot.at;
    if (before) lo = mid + 1;
    else hi = mid;
  }
  list.splice(lo, 0, slot);
}

/**
 * How many entries at the front of the list have been crossed by `value`.
 *
 * The prefix property is the whole reason the indexes are sorted the way they
 * are: in an ascending list every entry at or below the value has fired, and
 * in a descending list every entry at or above it has. Both are a count, and
 * finding the count is a binary search.
 */
function crossed(list: Slot[], value: number, ascending: boolean): number {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const hit = ascending ? list[mid].at <= value : list[mid].at >= value;
    if (hit) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function drop(list: Slot[], ruleId: string): void {
  const i = list.findIndex((s) => s.ruleId === ruleId);
  if (i >= 0) list.splice(i, 1);
}

function marketIndex(state: EngineState, market: string): MarketIndex {
  return (state.markets[market] ??= { above: [], below: [], trailing: [] });
}

/* ────────────────────────────── transitions ────────────────────────────── */

function move(
  rule: Rule,
  to: RuleState,
  at: number,
  reason: string,
  price?: number,
): Transition {
  const from = rule.state;
  rule.state = to;
  return price === undefined
    ? { ruleId: rule.id, from, to, at, reason }
    : { ruleId: rule.id, from, to, at, reason, price };
}

/* ──────────────────────────────── arming ───────────────────────────────── */

/**
 * Take an approved exit and start watching for it.
 *
 * Arrives "unbound" when the entry has not filled yet, which is the normal
 * case for exits compiled alongside a buy. The caller binds it the moment the
 * fill price is known.
 */
export function arm(
  state: EngineState,
  input: {
    rule: ExitRule;
    market: string;
    at: number;
    /**
     * What it does when it fires. Defaults to a sell, because exits are the
     * common case and every existing caller means one.
     *
     * A BUY here is a resting limit order — "buy $500 of SOL at $95" — and it
     * is the same machine watching the same price. The only difference is what
     * the seam does at the bottom.
     */
    side?: "buy" | "sell";
    /** The resting entry this exit belongs to, when it belongs to one. */
    parentId?: string;
    /**
     * The price the trigger is measured against.
     *
     * For an exit it is the ENTRY FILL. For a resting buy there is no entry
     * yet, so it is the market price at arm time — which is all "at $95" needs:
     * a reference to decide whether $95 is reached by falling or by rising.
     */
    entryPrice?: number;
    expiresAt?: number;
  },
): Step {
  const rule: Rule = {
    version: RULE_VERSION,
    id: input.rule.id,
    market: input.market,
    side: input.side ?? "sell",
    parentId: input.parentId ?? null,
    trigger: input.rule.trigger,
    amount: input.rule.amount,
    state: "unbound",
    armedAt: input.at,
    expiresAt: input.expiresAt ?? input.at + DEFAULT_AUTHORITY_MS,
    entryPrice: null,
    highWater: null,
    attempts: 0,
  };

  state.rules[rule.id] = rule;
  insert(state.expiries, { ruleId: rule.id, at: rule.expiresAt }, true);

  const transitions: Transition[] = [
    { ruleId: rule.id, from: "unbound", to: "unbound", at: input.at, reason: "armed" },
  ];

  if (input.entryPrice === undefined) return { state, fire: [], transitions };

  return bind(state, rule.id, input.entryPrice, input.at, transitions);
}

/**
 * Fix the rule's reference price and put it in the index.
 *
 * Called with the ENTRY FILL price, not the price when the order was placed.
 * A user who says "stop at -50%" means half of what they paid, and what they
 * paid includes the spread and the fee.
 */
export function bind(
  state: EngineState,
  ruleId: string,
  entryPrice: number,
  at: number,
  carry: Transition[] = [],
): Step {
  const rule = state.rules[ruleId];
  const transitions = [...carry];
  if (!rule || rule.state !== "unbound") return { state, fire: [], transitions };

  rule.entryPrice = entryPrice;
  if (rule.trigger.kind === "trailingStop") rule.highWater = entryPrice;

  const resolved = resolve(rule.trigger, entryPrice, at);
  place(state, rule, resolved);

  transitions.push(move(rule, "armed", at, `bound to entry at ${entryPrice}`, entryPrice));
  return { state, fire: [], transitions };
}

function place(state: EngineState, rule: Rule, resolved: Resolved): void {
  if (resolved.kind === "time") {
    insert(state.deadlines, { ruleId: rule.id, at: resolved.at }, true);
    return;
  }
  const index = marketIndex(state, rule.market);
  if (rule.trigger.kind === "trailingStop") {
    insert(index.below, { ruleId: rule.id, at: resolved.at }, false);
    insert(index.trailing, { ruleId: rule.id, at: rule.highWater! }, true);
    return;
  }
  insert(resolved.direction === "above" ? index.above : index.below, {
    ruleId: rule.id,
    at: resolved.at,
  }, resolved.direction === "above");
}

function unplace(state: EngineState, rule: Rule): void {
  const index = state.markets[rule.market];
  if (index) {
    drop(index.above, rule.id);
    drop(index.below, rule.id);
    drop(index.trailing, rule.id);
  }
  drop(state.deadlines, rule.id);
}

/* ───────────────────────────────── ticks ───────────────────────────────── */

/**
 * A new price for one market.
 *
 * Two jobs, in this order: raise any trailing high-water marks, then fire
 * whatever has crossed. The order matters — a new high must move its own stop
 * up BEFORE the crossing check runs, or a rule could fire against a threshold
 * the same tick just invalidated.
 */
export function onPrice(
  state: EngineState,
  market: string,
  price: number,
  at: number,
): Step {
  const index = state.markets[market];
  if (!index) return { state, fire: [], transitions: [] };

  const transitions: Transition[] = [];

  // ── new highs ──
  const beaten = crossed(index.trailing, price, true);
  if (beaten > 0) {
    const moved = index.trailing.splice(0, beaten);
    for (const slot of moved) {
      const rule = state.rules[slot.ruleId];
      if (!rule || rule.state !== "armed" || rule.trigger.kind !== "trailingStop") continue;
      rule.highWater = price;
      drop(index.below, rule.id);
      insert(index.below, {
        ruleId: rule.id,
        at: price * (1 - rule.trigger.percent / 100),
      }, false);
      insert(index.trailing, { ruleId: rule.id, at: price }, true);
    }
  }

  // ── crossings ──
  const fire: Rule[] = [];
  for (const [list, ascending] of [
    [index.above, true],
    [index.below, false],
  ] as const) {
    const n = crossed(list, price, ascending);
    if (n === 0) continue;
    for (const slot of list.splice(0, n)) {
      const rule = state.rules[slot.ruleId];
      /*
       * A rule not in "armed" here is not an error. It may have been
       * cancelled between ticks, or already claimed. Skipping quietly is the
       * correct behaviour; firing it again is the bug this guard exists for.
       */
      if (!rule || rule.state !== "armed") continue;
      unplace(state, rule);
      transitions.push(move(rule, "firing", at, "price crossed", price));
      fire.push(rule);
    }
  }

  return { state, fire, transitions };
}

/**
 * Time passed.
 *
 * Separate from onPrice because time-based exits are the gap-proof ones — a
 * market that gaps through a stop still passes through every second on the
 * way. A rule whose only trigger is a clock must not depend on a trade
 * printing to fire.
 */
export function onClock(state: EngineState, at: number): Step {
  const transitions: Transition[] = [];
  const fire: Rule[] = [];

  for (const slot of state.deadlines.splice(0, crossed(state.deadlines, at, true))) {
    const rule = state.rules[slot.ruleId];
    if (!rule || rule.state !== "armed") continue;
    unplace(state, rule);
    transitions.push(move(rule, "firing", at, "deadline reached"));
    fire.push(rule);
  }

  /*
   * EXPIRY IS CHECKED AFTER FIRING, and that ordering is a decision.
   *
   * A rule whose deadline and authority lapse in the same tick should fire —
   * the user's instruction was due, and the authority was still valid when it
   * became due. The other order silently drops an order that was owed.
   */
  for (const slot of state.expiries.splice(0, crossed(state.expiries, at, true))) {
    const rule = state.rules[slot.ruleId];
    if (!rule || TERMINAL.has(rule.state) || rule.state === "firing") continue;
    unplace(state, rule);
    transitions.push(move(rule, "expired", at, "authority expired before it fired"));
  }

  return { state, fire, transitions };
}

/* ──────────────────────────── outside events ───────────────────────────── */

/**
 * The position went flat. Every exit on it is now meaningless.
 *
 * AN EXIT REFERENCES AN ENTRY, and once that entry is gone so is the meaning
 * of "2x" or "-30% from entry" or "20% off the high". Leaving them armed is
 * not merely untidy — it is dangerous, and the damage is on the RE-ENTRY:
 *
 *   buy at $102, stop armed at $71        sell it all by hand at $105
 *   two weeks later, buy back in at $60   the $71 stop is still armed, still
 *                                         measured against an entry you left
 *                                         behind, and $60 is already below it
 *
 * The next tick sells the new position immediately. Same shape as the
 * trailing-stop high-water bug, which this function originally only guarded
 * against — the narrower version cancelled trailing stops and left drawdowns
 * and multiples armed, which are exactly as stale.
 *
 * RESTING BUYS ARE UNTOUCHED. Being flat is the state a limit buy exists to
 * end, so cancelling it here would delete the order at the moment it becomes
 * relevant. The side is the whole test.
 */
export function onFlat(state: EngineState, market: string, at: number): Step {
  const transitions: Transition[] = [];
  for (const rule of Object.values(state.rules)) {
    if (rule.market !== market || rule.side !== "sell") continue;
    if (rule.state !== "armed" && rule.state !== "unbound") continue;
    unplace(state, rule);
    transitions.push(move(rule, "cancelled", at, "position closed"));
  }
  return { state, fire: [], transitions };
}

/** The user revoked a rule. */
export function cancel(state: EngineState, ruleId: string, at: number): Step {
  const rule = state.rules[ruleId];
  if (!rule || TERMINAL.has(rule.state)) return { state, fire: [], transitions: [] };
  unplace(state, rule);
  drop(state.expiries, ruleId);
  return { state, fire: [], transitions: [move(rule, "cancelled", at, "cancelled by user")] };
}

/**
 * What happened when the caller tried to execute.
 *
 * A failure goes back to "armed" and re-enters the index, because the reason
 * is usually transient — a reverted swap, a dropped transaction, a pool that
 * moved. It gives up after MAX_ATTEMPTS rather than retrying forever into a
 * condition that is not going to improve.
 */
export function onResult(
  state: EngineState,
  ruleId: string,
  outcome: { ok: true } | { ok: false; reason: string; hold?: boolean },
  at: number,
): Step {
  const rule = state.rules[ruleId];
  if (!rule || rule.state !== "firing") return { state, fire: [], transitions: [] };

  if (outcome.ok) {
    drop(state.expiries, ruleId);
    return { state, fire: [], transitions: [move(rule, "filled", at, "executed")] };
  }

  /*
   * HELD, NOT FAILED: a sell that needs more than is owned.
   *
   * Back to watching with its attempts untouched. Counting it would kill the
   * order after three ticks — and the user's rule is that it waits, however
   * long, until the holding covers it (or it expires, which it still does).
   *
   * cipher: the indexes are level-triggered, so while the price sits past
   * the threshold this fires, holds and re-arms on every tick — two audit
   * rows a minute on the worker. Harmless at paper scale; when it is not,
   * gate the fire on the holding before the rule is claimed.
   */
  if (outcome.hold) {
    const transition = move(rule, "armed", at, `waiting: ${outcome.reason}`);
    place(state, rule, resolve(rule.trigger, rule.entryPrice!, at));
    return { state, fire: [], transitions: [transition] };
  }

  rule.attempts += 1;
  if (rule.attempts >= MAX_ATTEMPTS) {
    drop(state.expiries, ruleId);
    return {
      state,
      fire: [],
      transitions: [move(rule, "failed", at, `gave up after ${rule.attempts}: ${outcome.reason}`)],
    };
  }

  const transition = move(rule, "armed", at, `retry ${rule.attempts}: ${outcome.reason}`);
  place(state, rule, resolve(rule.trigger, rule.entryPrice!, at));
  return { state, fire: [], transitions: [transition] };
}

/* ───────────────────────────────── reading ─────────────────────────────── */

/** Rules currently watching, for the alerts panel. */
export function armed(state: EngineState, market?: string): Rule[] {
  return Object.values(state.rules).filter(
    (r) => r.state === "armed" && (market === undefined || r.market === market),
  );
}

/**
 * What a rule is waiting for, as a number the UI can render.
 *
 * Null for time triggers and unbound rules — neither has a price to show, and
 * inventing one would be worse than showing nothing.
 */
export function threshold(rule: Rule): number | null {
  if (rule.entryPrice === null) return null;
  const reference = rule.trigger.kind === "trailingStop" ? rule.highWater! : rule.entryPrice;
  const resolved = resolve(rule.trigger, reference, rule.armedAt);
  return resolved.kind === "price" ? resolved.at : null;
}

export type { Amount, ExitRule, Trigger };
