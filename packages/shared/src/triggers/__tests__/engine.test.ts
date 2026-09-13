import { test } from "node:test";
import assert from "node:assert/strict";
import {
  arm,
  armed,
  bind,
  cancel,
  emptyEngine,
  onClock,
  onFlat,
  onPrice,
  onResult,
  resolve,
  threshold,
  DEFAULT_AUTHORITY_MS,
} from "../engine.ts";
import type { ExitRule } from "../../order.ts";

const T0 = 1_700_000_000_000;
const MKT = "SOLUSDT";

function exit(id: string, trigger: ExitRule["trigger"]): ExitRule {
  return { id, trigger, amount: { kind: "percentOfPosition", value: 100 } };
}

/* ─────────────────────────────── thresholds ────────────────────────────── */

test("a multiple above 1x fires on the way up, below 1x on the way down", () => {
  assert.deepEqual(resolve({ kind: "priceMultiple", value: 2 }, 100, T0), {
    kind: "price",
    at: 200,
    direction: "above",
  });
  // The grammar accepts any positive multiple and lets validate.ts judge it.
  // Arming 0.8x above the entry would put it where price can never reach.
  assert.deepEqual(resolve({ kind: "priceMultiple", value: 0.8 }, 100, T0), {
    kind: "price",
    at: 80,
    direction: "below",
  });
});

test("a drawdown always fires downward, even at 0%", () => {
  const r = resolve({ kind: "drawdownFromEntry", percent: 0 }, 100, T0);
  assert.equal(r.kind === "price" && r.direction, "below");
});

test("a duration is measured from when the rule was bound, not written", () => {
  const r = resolve({ kind: "duration", seconds: 3600 }, 100, T0);
  assert.deepEqual(r, { kind: "time", at: T0 + 3_600_000 });
});

/* ──────────────────────────────── arming ───────────────────────────────── */

test("an exit armed before the entry fills cannot fire", () => {
  const s = emptyEngine();
  arm(s, { rule: exit("r1", { kind: "priceMultiple", value: 2 }), market: MKT, at: T0 });

  assert.equal(s.rules.r1.state, "unbound");
  assert.equal(armed(s).length, 0);

  // 2x of nothing is nothing. A tick at any price must not fire it.
  assert.equal(onPrice(s, MKT, 1_000_000, T0 + 1).fire.length, 0);
});

test("binding uses the fill price, and the rule starts watching", () => {
  const s = emptyEngine();
  arm(s, { rule: exit("r1", { kind: "priceMultiple", value: 2 }), market: MKT, at: T0 });
  bind(s, "r1", 101.5, T0 + 1);

  assert.equal(s.rules.r1.state, "armed");
  assert.equal(threshold(s.rules.r1), 203);
  assert.equal(onPrice(s, MKT, 202.99, T0 + 2).fire.length, 0);
  assert.equal(onPrice(s, MKT, 203, T0 + 3).fire.length, 1);
});

test("authority defaults to seven days and is recorded on the rule", () => {
  const s = emptyEngine();
  arm(s, {
    rule: exit("r1", { kind: "priceMultiple", value: 2 }),
    market: MKT,
    at: T0,
    entryPrice: 100,
  });
  assert.equal(s.rules.r1.expiresAt, T0 + DEFAULT_AUTHORITY_MS);
});

/* ──────────────────────────────── firing ───────────────────────────────── */

test("one tick fires every rung of a ladder that it crosses", () => {
  const s = emptyEngine();
  for (const [id, mult] of [["a", 2], ["b", 3], ["c", 5]] as const) {
    arm(s, {
      rule: exit(id, { kind: "priceMultiple", value: mult }),
      market: MKT,
      at: T0,
      entryPrice: 100,
    });
  }

  // A gap straight through the first two rungs.
  const step = onPrice(s, MKT, 320, T0 + 1);
  assert.deepEqual(step.fire.map((r) => r.id).sort(), ["a", "b"]);
  assert.equal(s.rules.c.state, "armed");
});

test("a rule fires exactly once, however many ticks cross it", () => {
  const s = emptyEngine();
  arm(s, {
    rule: exit("r1", { kind: "priceMultiple", value: 2 }),
    market: MKT,
    at: T0,
    entryPrice: 100,
  });

  assert.equal(onPrice(s, MKT, 250, T0 + 1).fire.length, 1);
  assert.equal(s.rules.r1.state, "firing");
  // Same price, a millisecond later. This is the double-spend case.
  assert.equal(onPrice(s, MKT, 250, T0 + 2).fire.length, 0);
  assert.equal(onPrice(s, MKT, 900, T0 + 3).fire.length, 0);
});

test("firing emits a transition carrying the price that caused it", () => {
  const s = emptyEngine();
  arm(s, {
    rule: exit("r1", { kind: "drawdownFromEntry", percent: 50 }),
    market: MKT,
    at: T0,
    entryPrice: 100,
  });
  const step = onPrice(s, MKT, 49, T0 + 1);
  assert.deepEqual(step.transitions, [
    { ruleId: "r1", from: "armed", to: "firing", at: T0 + 1, reason: "price crossed", price: 49 },
  ]);
});

test("a stop already underwater at arm time fires on the next tick", () => {
  const s = emptyEngine();
  arm(s, {
    rule: exit("r1", { kind: "drawdownFromEntry", percent: 50 }),
    market: MKT,
    at: T0,
    entryPrice: 100,
  });
  // validate.ts warns about this at arm time; the engine must still honour it
  // rather than sit on a rule whose condition is already true.
  assert.equal(onPrice(s, MKT, 30, T0 + 1).fire.length, 1);
});

/* ─────────────────────────────── trailing ──────────────────────────────── */

test("a trailing stop follows the high up and never comes back down", () => {
  const s = emptyEngine();
  arm(s, {
    rule: exit("t", { kind: "trailingStop", percent: 20 }),
    market: MKT,
    at: T0,
    entryPrice: 100,
  });
  assert.equal(threshold(s.rules.t), 80);

  onPrice(s, MKT, 200, T0 + 1);
  assert.equal(s.rules.t.highWater, 200);
  assert.equal(threshold(s.rules.t), 160);

  // A pullback must not lower the mark.
  onPrice(s, MKT, 170, T0 + 2);
  assert.equal(s.rules.t.highWater, 200);
  assert.equal(threshold(s.rules.t), 160);

  assert.equal(onPrice(s, MKT, 159, T0 + 3).fire.length, 1);
});

test("a new high and a crossing in the same tick does not fire", () => {
  const s = emptyEngine();
  arm(s, {
    rule: exit("t", { kind: "trailingStop", percent: 20 }),
    market: MKT,
    at: T0,
    entryPrice: 100,
  });
  // 300 beats the high AND is above the old 80 threshold. If highs were
  // raised after the crossing check, this would fire a stop on a 3x.
  assert.equal(onPrice(s, MKT, 300, T0 + 1).fire.length, 0);
  assert.equal(s.rules.t.highWater, 300);
});

test("going flat cancels trailing stops so a re-entry does not fire instantly", () => {
  const s = emptyEngine();
  arm(s, {
    rule: exit("t", { kind: "trailingStop", percent: 40 }),
    market: MKT,
    at: T0,
    entryPrice: 100,
  });
  onPrice(s, MKT, 500, T0 + 1);

  const step = onFlat(s, MKT, T0 + 2);
  assert.equal(s.rules.t.state, "cancelled");
  assert.equal(step.transitions[0].reason, "position closed");

  // Buying back in at 100 with a stale 500 high would fire at once.
  assert.equal(onPrice(s, MKT, 100, T0 + 3).fire.length, 0);
});

test("going flat cancels EVERY exit on that market, not just trailing ones", () => {
  /*
   * The narrow version cancelled trailing stops and left drawdowns and
   * multiples armed — which are exactly as stale, because all three measure
   * from an entry that no longer exists. The damage lands on the RE-ENTRY: a
   * $71 stop from a $102 entry, still armed, sells a new position bought at
   * $60 on the very next tick.
   */
  const s = emptyEngine();
  for (const [id, trigger] of [
    ["t", { kind: "trailingStop", percent: 40 }],
    ["p", { kind: "priceMultiple", value: 2 }],
    ["d", { kind: "drawdownFromEntry", percent: 30 }],
  ] as const) {
    arm(s, { rule: exit(id, trigger), market: MKT, at: T0, entryPrice: 100 });
  }

  onFlat(s, MKT, T0 + 1);
  assert.equal(s.rules.t.state, "cancelled");
  assert.equal(s.rules.p.state, "cancelled");
  assert.equal(s.rules.d.state, "cancelled");

  // Buying back in at any price must not fire a stop from the old entry.
  assert.equal(onPrice(s, MKT, 60, T0 + 2).fire.length, 0);
});

test("going flat leaves other markets alone", () => {
  const s = emptyEngine();
  arm(s, {
    rule: exit("t", { kind: "trailingStop", percent: 40 }),
    market: "BTCUSDT",
    at: T0,
    entryPrice: 100,
  });
  onFlat(s, MKT, T0 + 1);
  assert.equal(s.rules.t.state, "armed");
});

test("going flat never cancels a resting BUY", () => {
  // Being flat is the state a limit buy exists to end. Cancelling it here
  // would delete the order at the exact moment it becomes relevant.
  const s = emptyEngine();
  arm(s, {
    rule: exit("b", { kind: "priceAbsolute", value: 95 }),
    market: MKT,
    at: T0,
    side: "buy",
    entryPrice: 101,
  });
  onFlat(s, MKT, T0 + 1);
  assert.equal(s.rules.b.state, "armed");
});

test("going flat also clears exits still waiting on an entry", () => {
  // An unbound exit belongs to an order on a position that is now gone.
  const s = emptyEngine();
  arm(s, { rule: exit("u", { kind: "priceMultiple", value: 2 }), market: MKT, at: T0 });
  assert.equal(s.rules.u.state, "unbound");
  onFlat(s, MKT, T0 + 1);
  assert.equal(s.rules.u.state, "cancelled");
});

/* ──────────────────────────────── clock ────────────────────────────────── */

test("a time exit fires without any trade printing", () => {
  const s = emptyEngine();
  arm(s, {
    rule: exit("d", { kind: "duration", seconds: 60 }),
    market: MKT,
    at: T0,
    entryPrice: 100,
  });

  assert.equal(onClock(s, T0 + 59_000).fire.length, 0);
  assert.equal(onClock(s, T0 + 60_000).fire.length, 1);
});

test("authority that lapses before the rule fires expires it", () => {
  const s = emptyEngine();
  arm(s, {
    rule: exit("r1", { kind: "priceMultiple", value: 10 }),
    market: MKT,
    at: T0,
    entryPrice: 100,
  });

  const step = onClock(s, T0 + DEFAULT_AUTHORITY_MS);
  assert.equal(s.rules.r1.state, "expired");
  assert.equal(step.transitions[0].reason, "authority expired before it fired");
  assert.equal(onPrice(s, MKT, 5_000, T0 + DEFAULT_AUTHORITY_MS + 1).fire.length, 0);
});

test("a rule due at the instant its authority lapses still fires", () => {
  const s = emptyEngine();
  arm(s, {
    rule: exit("d", { kind: "duration", seconds: 10 }),
    market: MKT,
    at: T0,
    entryPrice: 100,
    expiresAt: T0 + 10_000,
  });

  // The instruction came due while the permission was still good. Expiring it
  // instead would silently drop an order that was owed.
  const step = onClock(s, T0 + 10_000);
  assert.equal(step.fire.length, 1);
  assert.equal(s.rules.d.state, "firing");
});

/* ─────────────────────────────── outcomes ──────────────────────────────── */

test("a successful fill is terminal", () => {
  const s = emptyEngine();
  arm(s, {
    rule: exit("r1", { kind: "priceMultiple", value: 2 }),
    market: MKT,
    at: T0,
    entryPrice: 100,
  });
  onPrice(s, MKT, 250, T0 + 1);
  onResult(s, "r1", { ok: true }, T0 + 2);

  assert.equal(s.rules.r1.state, "filled");
  assert.equal(onPrice(s, MKT, 300, T0 + 3).fire.length, 0);
});

test("a failed fill re-arms and can fire again", () => {
  const s = emptyEngine();
  arm(s, {
    rule: exit("r1", { kind: "priceMultiple", value: 2 }),
    market: MKT,
    at: T0,
    entryPrice: 100,
  });
  onPrice(s, MKT, 250, T0 + 1);
  onResult(s, "r1", { ok: false, reason: "reverted" }, T0 + 2);

  assert.equal(s.rules.r1.state, "armed");
  assert.equal(s.rules.r1.attempts, 1);
  assert.equal(onPrice(s, MKT, 260, T0 + 3).fire.length, 1);
});

test("it gives up rather than retrying into a condition that will not improve", () => {
  const s = emptyEngine();
  arm(s, {
    rule: exit("r1", { kind: "priceMultiple", value: 2 }),
    market: MKT,
    at: T0,
    entryPrice: 100,
  });

  for (let i = 1; i <= 3; i++) {
    onPrice(s, MKT, 250, T0 + i * 10);
    onResult(s, "r1", { ok: false, reason: "no route" }, T0 + i * 10 + 1);
  }

  assert.equal(s.rules.r1.state, "failed");
  assert.equal(onPrice(s, MKT, 400, T0 + 100).fire.length, 0);
});

test("a result for a rule that is not firing changes nothing", () => {
  const s = emptyEngine();
  arm(s, {
    rule: exit("r1", { kind: "priceMultiple", value: 2 }),
    market: MKT,
    at: T0,
    entryPrice: 100,
  });
  const step = onResult(s, "r1", { ok: true }, T0 + 1);
  assert.deepEqual(step.transitions, []);
  assert.equal(s.rules.r1.state, "armed");
});

/* ────────────────────────────── cancelling ─────────────────────────────── */

test("cancelling takes the rule out of the index immediately", () => {
  const s = emptyEngine();
  arm(s, {
    rule: exit("r1", { kind: "priceMultiple", value: 2 }),
    market: MKT,
    at: T0,
    entryPrice: 100,
  });
  cancel(s, "r1", T0 + 1);

  assert.equal(s.rules.r1.state, "cancelled");
  assert.equal(onPrice(s, MKT, 250, T0 + 2).fire.length, 0);
});

test("cancelling something already fired does not resurrect it", () => {
  const s = emptyEngine();
  arm(s, {
    rule: exit("r1", { kind: "priceMultiple", value: 2 }),
    market: MKT,
    at: T0,
    entryPrice: 100,
  });
  onPrice(s, MKT, 250, T0 + 1);
  onResult(s, "r1", { ok: true }, T0 + 2);

  assert.deepEqual(cancel(s, "r1", T0 + 3).transitions, []);
  assert.equal(s.rules.r1.state, "filled");
});

/* ──────────────────────────────── scale ────────────────────────────────── */

test("ten thousand rules on one market, and only the crossed ones come back", () => {
  const s = emptyEngine();
  for (let i = 0; i < 10_000; i++) {
    arm(s, {
      rule: exit(`r${i}`, { kind: "priceAbsolute", value: 1_000 + i }),
      market: MKT,
      at: T0,
      entryPrice: 100,
    });
  }

  const step = onPrice(s, MKT, 1_004, T0 + 1);
  assert.deepEqual(step.fire.map((r) => r.id).sort(), ["r0", "r1", "r2", "r3", "r4"]);
  assert.equal(armed(s).length, 9_995);
});

/* ─────────────────────────── resting buys ──────────────────────────────── */

test("a resting buy below the market waits for the price to come down", () => {
  const s = emptyEngine();
  arm(s, {
    rule: exit("b1", { kind: "priceAbsolute", value: 95 }),
    market: MKT,
    at: T0,
    side: "buy",
    entryPrice: 101, // the market when the order was placed
  });

  assert.equal(s.rules.b1.side, "buy");
  assert.equal(onPrice(s, MKT, 96, T0 + 1).fire.length, 0);
  assert.equal(onPrice(s, MKT, 95, T0 + 2).fire.length, 1);
});

test("a resting buy ABOVE the market waits for a breakout", () => {
  const s = emptyEngine();
  arm(s, {
    rule: exit("b1", { kind: "priceAbsolute", value: 120 }),
    market: MKT,
    at: T0,
    side: "buy",
    entryPrice: 101,
  });

  // Direction is derived from the reference, so the same trigger kind serves
  // "buy the dip" and "buy the breakout" without a second field to get wrong.
  assert.equal(onPrice(s, MKT, 119, T0 + 1).fire.length, 0);
  assert.equal(onPrice(s, MKT, 121, T0 + 2).fire.length, 1);
});

test("rules default to selling, so every existing caller still means an exit", () => {
  const s = emptyEngine();
  arm(s, {
    rule: exit("r1", { kind: "priceMultiple", value: 2 }),
    market: MKT,
    at: T0,
    entryPrice: 100,
  });
  assert.equal(s.rules.r1.side, "sell");
});

test("a resting buy is not cancelled when the position goes flat", () => {
  const s = emptyEngine();
  arm(s, {
    rule: exit("b1", { kind: "priceAbsolute", value: 95 }),
    market: MKT,
    at: T0,
    side: "buy",
    entryPrice: 101,
  });
  arm(s, {
    rule: exit("t1", { kind: "trailingStop", percent: 20 }),
    market: MKT,
    at: T0,
    entryPrice: 101,
  });

  // Going flat clears trailing stops — they measure from a high that no longer
  // means anything. A resting BUY is the opposite: being flat is the state it
  // exists to end.
  onFlat(s, MKT, T0 + 1);
  assert.equal(s.rules.t1.state, "cancelled");
  assert.equal(s.rules.b1.state, "armed");
});

test("an exit binds only to the entry it was armed with", () => {
  const s = emptyEngine();
  /*
   * Two resting buys on the same market, one with a take-profit. Before the
   * parentId existed, the entry WITHOUT an exit filling first bound the other
   * order's take-profit to its own price — a 2x target priced off a fill that
   * had nothing to do with it, shown in the alerts panel as armed.
   */
  arm(s, {
    rule: exit("cheap", { kind: "priceAbsolute", value: 95 }),
    market: MKT,
    at: T0,
    side: "buy",
    entryPrice: 101,
  });
  arm(s, {
    rule: exit("tp", { kind: "priceMultiple", value: 2 }),
    market: MKT,
    at: T0,
    parentId: "cheap",
  });
  arm(s, {
    rule: exit("breakout", { kind: "priceAbsolute", value: 110 }),
    market: MKT,
    at: T0,
    side: "buy",
    entryPrice: 101,
  });

  assert.equal(s.rules.tp.parentId, "cheap");
  assert.equal(s.rules.tp.state, "unbound");

  // The breakout fills. Its id is not "cheap", so the take-profit must not move.
  const step = onPrice(s, MKT, 110, T0 + 1);
  assert.deepEqual(step.fire.map((r) => r.id), ["breakout"]);
  assert.equal(s.rules.tp.state, "unbound");
});
