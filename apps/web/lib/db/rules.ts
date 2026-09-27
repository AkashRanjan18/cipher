import { resolve, type Rule, type Transition } from "@cipher/shared";
import { db, num } from "./client.ts";

/**
 * Rules, in the database.
 *
 * The engine in packages/shared is unchanged and stays pure — it still takes
 * state and an event and returns new state. What changes is where the state
 * lives between ticks: in the browser it was a React ref, and here it is rows,
 * because a worker has no memory from one minute to the next.
 *
 * THE SORTED INDEX BECOMES A POSTGRES INDEX. `threshold` and `direction` are
 * written at bind time so "which rules just crossed" is one indexed query
 * rather than loading every armed rule and resolving each one. Same idea as
 * the in-memory version, same reason: never iterate every rule on a price tick.
 */

type Row = Record<string, unknown>;

/**
 * A rule and whose it is.
 *
 * The Rule type has no user on it, deliberately — the engine has no concept of
 * one and should not grow one. But the worker needs to know whose account to
 * charge, and asking per rule is a query per rule: at a hundred crossings in a
 * tick that is a hundred extra round trips to answer something the first query
 * already selected. The rows carry it; this pairs it back up.
 */
export interface Owned {
  rule: Rule;
  userId: string;
}

function owned(r: Row): Owned {
  return { rule: toRule(r), userId: String(r.user_id) };
}

function toRule(r: Row): Rule {
  return {
    version: 1,
    id: String(r.id),
    market: String(r.market),
    side: r.side as "buy" | "sell",
    parentId: r.parent_id === null ? null : String(r.parent_id),
    trigger: r.trigger as Rule["trigger"],
    amount: r.amount as Rule["amount"],
    state: r.state as Rule["state"],
    armedAt: num(r.armed_at),
    expiresAt: num(r.expires_at),
    entryPrice: r.entry_price === null ? null : num(r.entry_price),
    highWater: r.high_water === null ? null : num(r.high_water),
    attempts: num(r.attempts),
  };
}

/** Where a rule sits, for the columns the worker searches on. */
function placement(rule: Rule): {
  threshold: number | null;
  direction: "above" | "below" | null;
  deadline: number | null;
} {
  if (rule.entryPrice === null) return { threshold: null, direction: null, deadline: null };
  const reference = rule.trigger.kind === "trailingStop" ? (rule.highWater ?? rule.entryPrice) : rule.entryPrice;
  const r = resolve(rule.trigger, reference, rule.armedAt);
  return r.kind === "price"
    ? { threshold: r.at, direction: r.direction, deadline: null }
    : { threshold: null, direction: null, deadline: r.at };
}

export async function insertRule(userId: string, rule: Rule): Promise<void> {
  const p = placement(rule);
  const sql = db();
  await sql`
    insert into rules (
      id, user_id, market, side, parent_id, trigger, amount, state,
      armed_at, expires_at, entry_price, high_water, attempts,
      threshold, direction, deadline
    ) values (
      ${rule.id}, ${userId}, ${rule.market}, ${rule.side}, ${rule.parentId},
      ${JSON.stringify(rule.trigger)}, ${JSON.stringify(rule.amount)}, ${rule.state},
      ${rule.armedAt}, ${rule.expiresAt}, ${rule.entryPrice}, ${rule.highWater},
      ${rule.attempts}, ${p.threshold}, ${p.direction}, ${p.deadline}
    )
    on conflict (id) do nothing
  `;
}

export async function rulesFor(userId: string): Promise<Rule[]> {
  const rows = (await db()`
    select * from rules
    where user_id = ${userId} and state in ('unbound', 'armed', 'firing')
    order by armed_at asc
  `) as Row[];
  return rows.map(toRule);
}

export async function transitionsFor(userId: string, limit = 100): Promise<Transition[]> {
  /*
   * ORDERED BY id AS WELL AS BY at, because `at` is not unique.
   *
   * Every transition a single tick emits shares one timestamp — firing and
   * filled are written milliseconds apart but stamped with the same `now`, on
   * purpose, so the trail says when the tick happened rather than when each
   * row was inserted. With only `at` in the sort, Postgres is free to return
   * them in any order, and it does: the audit trail showed a rule reaching
   * `filled` BEFORE it reached `firing`, and a stop reporting "price crossed"
   * after the cancellation that explained it.
   *
   * That is not a cosmetic ordering problem. This table is the evidence for
   * "why did you sell my SOL", and evidence that reorders itself is worth
   * nothing. `id` is a bigserial, so it is insertion order, which is the true
   * order — the tiebreak costs nothing and makes the sort total.
   */
  const rows = (await db()`
    select * from rule_transitions
    where user_id = ${userId}
    order by at desc, id desc
    limit ${limit}
  `) as Row[];
  return rows.reverse().map((r) => ({
    ruleId: String(r.rule_id),
    from: r.from_state as Rule["state"],
    to: r.to_state as Rule["state"],
    at: num(r.at),
    reason: String(r.reason),
    ...(r.price === null ? {} : { price: num(r.price) }),
  }));
}

export async function record(userId: string, transitions: Transition[]): Promise<void> {
  if (transitions.length === 0) return;
  const sql = db();
  for (const t of transitions) {
    await sql`
      insert into rule_transitions (rule_id, user_id, from_state, to_state, at, reason, price)
      values (${t.ruleId}, ${userId}, ${t.from}, ${t.to}, ${t.at}, ${t.reason}, ${t.price ?? null})
    `;
  }
}

/**
 * Claim a rule for firing. THE LOCK.
 *
 * Returns true only for the caller that won. Two workers, or one worker and a
 * browser tab, can both see the same crossing in the same second — and the
 * loser must not also sell. The condition on `state` is what makes this
 * exactly-once: the update is atomic, so precisely one caller sees a row
 * change.
 *
 * No Redis, no queue. The database is already the thing everyone agrees on.
 */
export async function claim(ruleId: string): Promise<boolean> {
  const rows = (await db()`
    update rules set state = 'firing'
    where id = ${ruleId} and state = 'armed'
    returning id
  `) as Row[];
  return rows.length > 0;
}

/**
 * Move a rule to `state` — ONLY from the states in `from`, when given.
 *
 * Unguarded, an overlapping tick (a cron retry, a slow run past its minute)
 * could write a stale state over a newer one: expire a rule another tick was
 * firing, or arm one it had already filled. The guard makes every transition
 * conditional on the state the caller believes the rule is in, the same way
 * claim() does for the one that matters most.
 */
export async function setState(
  ruleId: string,
  state: Rule["state"],
  extra?: { attempts?: number; highWater?: number; entryPrice?: number },
  from?: Rule["state"][],
): Promise<boolean> {
  const sql = db();
  const guard = from ?? null;
  const rows = await sql`
    update rules set
      state = ${state},
      attempts = coalesce(${extra?.attempts ?? null}, attempts),
      high_water = coalesce(${extra?.highWater ?? null}, high_water),
      entry_price = coalesce(${extra?.entryPrice ?? null}, entry_price)
    where id = ${ruleId}
      and (${guard}::text[] is null or state = any(${guard}::text[]))
    returning id
  `;
  /* Whether it happened — so the audit trail records only moves that did. */
  return rows.length > 0;
}

/**
 * Re-place a rule in the index after its reference price moved — only if it
 * is still in `expected`. Two callers, two different expectations: a trailing
 * stop's new high applies to an ARMED rule, and a child exit binds from
 * UNBOUND. Unguarded, a tick holding a stale copy re-armed a rule another tick
 * had just fired, and it fired twice (review, 27 Sep 2026).
 */
export async function replace(rule: Rule, expected: Rule["state"]): Promise<void> {
  const p = placement(rule);
  await db()`
    update rules set
      amount = ${JSON.stringify(rule.amount)},
      entry_price = ${rule.entryPrice},
      high_water = ${rule.highWater},
      armed_at = ${rule.armedAt},
      threshold = ${p.threshold},
      direction = ${p.direction},
      deadline = ${p.deadline},
      state = ${rule.state}
    where id = ${rule.id} and state = ${expected}
  `;
}

/**
 * Everything that has just crossed, across every user.
 *
 * One query per market, not one per rule and not one per user. The partial
 * index on (market, direction, threshold) where state = 'armed' means this
 * touches only the rules that could possibly fire.
 */
export async function crossed(market: string, price: number): Promise<Owned[]> {
  const rows = (await db()`
    select * from rules
    where state = 'armed'
      and market = ${market}
      and (
        (direction = 'above' and threshold <= ${price}) or
        (direction = 'below' and threshold >= ${price})
      )
    limit 500
  `) as Row[];
  return rows.map(owned);
}

/** Trailing stops whose high-water mark this price has beaten. */
export async function newHighs(market: string, price: number): Promise<Owned[]> {
  const rows = (await db()`
    select * from rules
    where state = 'armed'
      and market = ${market}
      and trigger->>'kind' = 'trailingStop'
      and high_water < ${price}
    limit 500
  `) as Row[];
  return rows.map(owned);
}

export async function due(now: number): Promise<Owned[]> {
  const rows = (await db()`
    select * from rules
    where state = 'armed' and deadline is not null and deadline <= ${now}
    limit 500
  `) as Row[];
  return rows.map(owned);
}

export async function lapsed(now: number): Promise<Owned[]> {
  const rows = (await db()`
    select * from rules
    where state in ('unbound', 'armed') and expires_at <= ${now}
    limit 500
  `) as Row[];
  return rows.map(owned);
}

/** Which markets anyone is watching. Nothing else needs a price fetched. */
export async function watchedMarkets(): Promise<string[]> {
  const rows = (await db()`
    select distinct market from rules where state = 'armed'
  `) as Row[];
  return rows.map((r) => String(r.market));
}

/**
 * Every live SELL rule one user has on one market.
 *
 * Sell-side only: a resting BUY on the same market must survive the position
 * emptying, because being flat is the state it exists to end.
 */
export async function exitsOn(market: string, userId: string): Promise<Owned[]> {
  const rows = (await db()`
    select * from rules
    where user_id = ${userId}
      and market = ${market}
      and side = 'sell'
      /* ARMED only. An unbound exit is waiting for a resting buy that has
         not filled — it belongs to the NEXT position, and closing this one
         must not cancel the stop the user set for that. */
      and state = 'armed'
    limit 200
  `) as Row[];
  return rows.map(owned);
}

/**
 * A position just went flat: cancel every exit still armed on it.
 *
 * They all measure from an entry that no longer exists, and the damage lands
 * on the re-entry — a stop at $71 from a $102 entry, still armed, sells a
 * position bought back at $60 on the next tick. The worker did this when a
 * RULE emptied the position; a manual "sell all" through /api/trade did not,
 * so the old stop stayed live. One function, both callers.
 *
 * Returns the transitions for the caller's audit write. `except` skips the
 * rule that did the closing, which records its own transition.
 */
export async function cancelExitsOnClose(
  userId: string,
  market: string,
  at: number,
  except?: string,
): Promise<Transition[]> {
  const out: Transition[] = [];
  for (const { rule } of await exitsOn(market, userId)) {
    if (rule.id === except) continue;
    /* Only recorded if it moved: a rule the worker claimed a moment ago is
       `firing`, the guard skips it, and the trail must not say otherwise. */
    if (await setState(rule.id, "cancelled", undefined, ["armed"])) {
      out.push({ ruleId: rule.id, from: rule.state, to: "cancelled", at, reason: "position closed" });
    }
  }
  return out;
}

/** Exits waiting on a resting entry that has now filled. */
export async function childrenOf(parentId: string): Promise<Owned[]> {
  const rows = (await db()`
    select * from rules where parent_id = ${parentId} and state = 'unbound'
  `) as Row[];
  return rows.map(owned);
}

/**
 * Cancel a rule, and say WHAT IT WAS before it was cancelled.
 *
 * The state has to come back because the audit trail records the transition,
 * and this returned a boolean — so the route wrote `from: "armed"` for every
 * cancellation, including rules cancelled while still unbound. An append-only
 * log that states the wrong prior state is worse than no log: it is a false
 * record that nothing downstream can correct.
 *
 * The CTE is what makes the old value readable. `update ... returning` hands
 * back the NEW row by definition, so the previous state has to be captured in
 * a snapshot taken before the write.
 */
export async function cancelRule(
  userId: string,
  ruleId: string,
): Promise<Rule["state"] | null> {
  const rows = (await db()`
    with prev as (
      select id, state from rules
      where id = ${ruleId} and user_id = ${userId} and state in ('unbound', 'armed')
    )
    update rules set state = 'cancelled'
    from prev
    where rules.id = prev.id
    returning prev.state as was
  `) as Row[];
  return rows[0] ? (rows[0].was as Rule["state"]) : null;
}

export async function beat(note: string): Promise<void> {
  await db()`update heartbeat set beat_at = now(), note = ${note} where id = 1`;
}

export async function lastBeat(): Promise<number | null> {
  const rows = (await db()`select beat_at from heartbeat where id = 1`) as Row[];
  return rows[0] ? new Date(String(rows[0].beat_at)).getTime() : null;
}
