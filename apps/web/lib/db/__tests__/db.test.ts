import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { Rule } from "@cipher/shared";
import { database, type Harness } from "./harness.ts";
import { ensureUser, loadAccount, loadFills, saveFill, resetAccount } from "../accounts.ts";
import {
  beat,
  cancelRule,
  childrenOf,
  claim,
  crossed,
  due,
  exitsOn,
  insertRule,
  lapsed,
  lastBeat,
  newHighs,
  record,
  replace,
  rulesFor,
  setState,
  transitionsFor,
  watchedMarkets,
} from "../rules.ts";
import { lastPrices, recordPrices, ticksSince } from "../prices.ts";
import type { SolPrice } from "../../chain/prices.ts";

/**
 * The server path, against a real Postgres.
 *
 * Everything under lib/db had never executed before this file existed. These
 * tests are weighted deliberately towards what only a database can get wrong:
 * parameter typing, numeric precision, index predicates, and the atomicity the
 * whole exactly-once guarantee rests on.
 */

const SOL = "So11111111111111111111111111111111111111112";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const T0 = 1_700_000_000_000;
const USER = "did:privy:alice";
const OTHER = "did:privy:bob";

let h: Harness;

before(async () => {
  h = await database();
});
after(async () => {
  await h.close();
});
beforeEach(async () => {
  await h.reset();
  await ensureUser(USER);
  await ensureUser(OTHER);
});

function rule(over: Partial<Rule> = {}): Rule {
  return {
    version: 1,
    id: "r1",
    market: SOL,
    side: "sell",
    parentId: null,
    trigger: { kind: "priceMultiple", value: 2 },
    amount: { kind: "percentOfPosition", value: 100 },
    state: "armed",
    armedAt: T0,
    expiresAt: T0 + 7 * 86_400_000,
    entryPrice: 100,
    highWater: null,
    attempts: 0,
    ...over,
  };
}

function price(over: Partial<SolPrice> = {}): SolPrice {
  return {
    mint: SOL,
    usd: 142.5,
    blockId: 300_000_000,
    decimals: 9,
    liquidityUsd: 4_200_000,
    change24h: 1.25,
    ...over,
  };
}

/* ──────────────────────────────── accounts ─────────────────────────────── */

test("a new user opens with the paper deposit, and twice is still once", async () => {
  await ensureUser(USER);
  const a = await loadAccount(USER);
  assert.equal(a?.usdc, 10_000);
  assert.equal(a?.sol, 0);
  assert.deepEqual(a?.fills, []);
});

test("loadAccount is null for someone who has never signed in", async () => {
  assert.equal(await loadAccount("did:privy:nobody"), null);
});

test("money survives the round trip to eight decimal places", async () => {
  /*
   * The columns are numeric, not double precision, because binary floating
   * point cannot represent 0.1 and a ledger out by a cent per trade is not a
   * ledger. This is the test that the choice actually took effect — a column
   * silently declared double would pass everything else in this file.
   */
  const a = (await loadAccount(USER))!;
  await saveFill(
    USER,
    { ...a, usdc: 9_876.12345678, sol: 12.00000001, costBasis: 123.45678901 },
    {
      id: "f1",
      ts: 1_700_000_001,
      side: "buy",
      qty: 12.00000001,
      price: 142.33333333,
      feeUsd: 0.61111111,
      realisedUsd: 0,
      squawk: "bought the dip",
      source: "sana",
    },
  );

  const back = (await loadAccount(USER))!;
  assert.equal(back.usdc, 9_876.12345678);
  assert.equal(back.sol, 12.00000001);
  assert.equal(back.costBasis, 123.45678901);
  assert.equal(back.fills.length, 1);
  assert.equal(back.fills[0].price, 142.33333333);
  assert.equal(back.fills[0].source, "sana");
});

test("the same fill id cannot be written twice", async () => {
  const a = (await loadAccount(USER))!;
  const fill = {
    id: "f1",
    ts: 1_700_000_001,
    side: "buy" as const,
    qty: 1,
    price: 100,
    feeUsd: 0.5,
    realisedUsd: 0,
    squawk: "",
    source: "ticket" as const,
  };
  await saveFill(USER, a, fill);
  await saveFill(USER, a, fill);
  assert.equal((await loadFills(USER)).length, 1);
});

test("fills come back oldest first however they were written", async () => {
  const a = (await loadAccount(USER))!;
  for (const ts of [300, 100, 200]) {
    await saveFill(USER, a, {
      id: `f${ts}`,
      ts,
      side: "buy",
      qty: 1,
      price: 1,
      feeUsd: 0,
      realisedUsd: 0,
      squawk: "",
      source: "ticket",
    });
  }
  assert.deepEqual(
    (await loadFills(USER)).map((f) => f.ts),
    [100, 200, 300],
  );
});

test("resetting an account also disarms its rules, and nobody else's", async () => {
  await insertRule(USER, rule({ id: "mine" }));
  await insertRule(OTHER, rule({ id: "theirs" }));
  await resetAccount(USER);

  assert.deepEqual(
    (await rulesFor(USER)).map((r) => r.id),
    [],
  );
  assert.deepEqual(
    (await rulesFor(OTHER)).map((r) => r.id),
    ["theirs"],
  );
  assert.equal((await loadAccount(USER))!.usdc, 10_000);
});

/* ───────────────────────────────── rules ───────────────────────────────── */

test("a rule survives the round trip with its trigger and amount intact", async () => {
  await insertRule(USER, rule({ trigger: { kind: "trailingStop", percent: 20 }, highWater: 150 }));
  const [back] = await rulesFor(USER);
  assert.deepEqual(back.trigger, { kind: "trailingStop", percent: 20 });
  assert.deepEqual(back.amount, { kind: "percentOfPosition", value: 100 });
  assert.equal(back.highWater, 150);
  assert.equal(back.parentId, null);
  assert.equal(back.side, "sell");
});

test("arming the same rule id twice does not duplicate it", async () => {
  await insertRule(USER, rule());
  await insertRule(USER, rule());
  assert.equal((await rulesFor(USER)).length, 1);
});

test("the threshold is written at arm time, resolved, not the raw trigger", async () => {
  await insertRule(USER, rule({ id: "tp", trigger: { kind: "priceMultiple", value: 2 } }));
  await insertRule(USER, rule({ id: "st", trigger: { kind: "drawdownFromEntry", percent: 50 } }));

  const rows = await h.pg.query<{ id: string; threshold: string; direction: string }>(
    "select id, threshold, direction from rules order by id",
  );
  assert.deepEqual(
    rows.rows.map((r) => [r.id, Number(r.threshold), r.direction]),
    [
      ["st", 50, "below"],
      ["tp", 200, "above"],
    ],
  );
});

test("an unbound rule has no threshold, so it cannot be found by any price", async () => {
  await insertRule(USER, rule({ state: "unbound", entryPrice: null }));
  assert.equal((await crossed(SOL, 1_000_000)).length, 0);
  assert.equal((await crossed(SOL, 0.000001)).length, 0);
});

test("crossing finds upward and downward rules and leaves the rest alone", async () => {
  await insertRule(USER, rule({ id: "tp", trigger: { kind: "priceMultiple", value: 2 } }));
  await insertRule(USER, rule({ id: "st", trigger: { kind: "drawdownFromEntry", percent: 50 } }));
  await insertRule(USER, rule({ id: "far", trigger: { kind: "priceMultiple", value: 10 } }));

  assert.deepEqual(
    (await crossed(SOL, 200)).map((o) => o.rule.id),
    ["tp"],
  );
  assert.deepEqual(
    (await crossed(SOL, 49)).map((o) => o.rule.id),
    ["st"],
  );
  assert.equal((await crossed(SOL, 120)).length, 0);
});

test("a crossing carries whose rule it is, without a second query", async () => {
  await insertRule(OTHER, rule({ id: "theirs" }));
  const [hit] = await crossed(SOL, 500);
  assert.equal(hit.userId, OTHER);
});

test("rules on another market are not crossed by this one's price", async () => {
  await insertRule(USER, rule({ id: "bonk", market: BONK }));
  assert.equal((await crossed(SOL, 500)).length, 0);
  assert.equal((await crossed(BONK, 500)).length, 1);
});

test("claiming is exactly once, even when two workers race", async () => {
  /*
   * THE WHOLE OF EXACTLY-ONCE. Two workers, or a worker and an open tab, can
   * see the same crossing in the same second, and only the one whose UPDATE
   * changed a row may trade. Firing them concurrently rather than in sequence
   * is the point: in sequence, almost any wrong implementation passes.
   */
  await insertRule(USER, rule());
  const [a, b] = await Promise.all([claim("r1"), claim("r1")]);
  assert.equal(Number(a) + Number(b), 1);
  assert.equal(await claim("r1"), false);
});

test("a rule that is not armed cannot be claimed", async () => {
  await insertRule(USER, rule({ state: "unbound", entryPrice: null }));
  assert.equal(await claim("r1"), false);
});

test("setState can change one field without clearing the others", async () => {
  /*
   * `coalesce($1, attempts)` with an untyped null parameter is exactly the
   * kind of thing that works in every unit test and throws "could not
   * determine data type of parameter" against a real server.
   */
  await insertRule(USER, rule({ highWater: 150 }));
  await setState("r1", "armed", { attempts: 2 });
  const [back] = await rulesFor(USER);
  assert.equal(back.attempts, 2);
  assert.equal(back.highWater, 150, "high water was cleared by an unrelated update");
  assert.equal(back.entryPrice, 100);
});

test("setState with nothing extra leaves every number where it was", async () => {
  await insertRule(USER, rule({ highWater: 150, attempts: 1 }));
  await setState("r1", "failed");
  const rows = await h.pg.query<{ attempts: number; high_water: string; entry_price: string }>(
    "select attempts, high_water, entry_price from rules where id = 'r1'",
  );
  assert.equal(rows.rows[0].attempts, 1);
  assert.equal(Number(rows.rows[0].high_water), 150);
  assert.equal(Number(rows.rows[0].entry_price), 100);
});

/* ──────────────────────────────── trailing ─────────────────────────────── */

test("a new high moves a trailing stop's threshold up and never back down", async () => {
  const t = rule({ trigger: { kind: "trailingStop", percent: 20 }, highWater: 100 });
  await insertRule(USER, t);

  assert.deepEqual(
    (await newHighs(SOL, 200)).map((o) => o.rule.id),
    ["r1"],
  );
  await replace({ ...t, highWater: 200 });

  const rows = await h.pg.query<{ threshold: string }>("select threshold from rules where id='r1'");
  assert.equal(Number(rows.rows[0].threshold), 160);

  // A pullback is not a new high.
  assert.equal((await newHighs(SOL, 170)).length, 0);
  assert.equal((await crossed(SOL, 159)).length, 1);
});

test("only trailing stops have highs to beat", async () => {
  await insertRule(
    USER,
    rule({ trigger: { kind: "drawdownFromEntry", percent: 20 }, highWater: 100 }),
  );
  assert.equal((await newHighs(SOL, 5_000)).length, 0);
});

/* ───────────────────────────── clock and expiry ────────────────────────── */

test("a deadline is found by the clock, not by a price", async () => {
  await insertRule(USER, rule({ trigger: { kind: "duration", seconds: 3600 }, armedAt: T0 }));
  assert.equal((await crossed(SOL, 1_000_000)).length, 0);
  assert.equal((await due(T0 + 3_599_000)).length, 0);
  assert.equal((await due(T0 + 3_600_000)).length, 1);
});

test("authority lapsing finds unbound rules too, because they are still permission", async () => {
  await insertRule(USER, rule({ id: "a", expiresAt: T0 + 1000 }));
  await insertRule(
    USER,
    rule({ id: "b", state: "unbound", entryPrice: null, expiresAt: T0 + 1000 }),
  );
  await insertRule(USER, rule({ id: "c", expiresAt: T0 + 10_000_000 }));

  assert.deepEqual(
    (await lapsed(T0 + 2000)).map((o) => o.rule.id).sort(),
    ["a", "b"],
  );
});

/* ───────────────────────── siblings, parents, cancels ──────────────────── */

test("only the markets someone is watching get a price fetched", async () => {
  await insertRule(USER, rule({ id: "a", market: SOL }));
  await insertRule(USER, rule({ id: "b", market: BONK }));
  await insertRule(USER, rule({ id: "c", market: BONK }));
  await insertRule(
    USER,
    rule({ id: "d", market: "unwatched", state: "unbound", entryPrice: null }),
  );

  assert.deepEqual((await watchedMarkets()).sort(), [BONK, SOL].sort());
});

test("exits on a market are that user's sells only, and a resting buy survives", async () => {
  await insertRule(USER, rule({ id: "sell", side: "sell" }));
  await insertRule(USER, rule({ id: "buy", side: "buy" }));
  await insertRule(USER, rule({ id: "waiting", side: "sell", state: "unbound", entryPrice: null }));
  await insertRule(OTHER, rule({ id: "theirs", side: "sell" }));

  assert.deepEqual(
    (await exitsOn(SOL, USER)).map((o) => o.rule.id).sort(),
    ["sell", "waiting"],
  );
});

test("exits bind only to the entry they were armed with", async () => {
  await insertRule(USER, rule({ id: "entryA", side: "buy" }));
  await insertRule(USER, rule({ id: "entryB", side: "buy" }));
  await insertRule(
    USER,
    rule({ id: "childA", state: "unbound", entryPrice: null, parentId: "entryA" }),
  );
  await insertRule(
    USER,
    rule({ id: "childB", state: "unbound", entryPrice: null, parentId: "entryB" }),
  );

  assert.deepEqual(
    (await childrenOf("entryA")).map((o) => o.rule.id),
    ["childA"],
  );
  assert.deepEqual(
    (await childrenOf("entryB")).map((o) => o.rule.id),
    ["childB"],
  );
});

test("binding a child writes its threshold from the price actually paid", async () => {
  await insertRule(
    USER,
    rule({
      id: "c",
      state: "unbound",
      entryPrice: null,
      parentId: "e",
      trigger: { kind: "priceMultiple", value: 2 },
    }),
  );
  const [child] = await childrenOf("e");
  await replace({ ...child.rule, entryPrice: 102.51, highWater: 102.51, state: "armed" });

  assert.deepEqual(
    (await crossed(SOL, 205.02)).map((o) => o.rule.id),
    ["c"],
  );
});

test("cancelling is scoped to the owner", async () => {
  await insertRule(USER, rule());
  assert.equal(await cancelRule(OTHER, "r1"), false);
  assert.equal(await cancelRule(USER, "r1"), true);
  // Terminal states never transition again.
  assert.equal(await cancelRule(USER, "r1"), false);
});

/* ────────────────────────────── audit trail ────────────────────────────── */

test("transitions come back oldest first, with the price that caused them", async () => {
  await record(USER, [
    {
      ruleId: "r1",
      from: "armed",
      to: "firing",
      at: T0 + 1,
      reason: "price crossed",
      price: 205.01,
    },
    { ruleId: "r1", from: "firing", to: "filled", at: T0 + 2, reason: "executed", price: 204.9 },
  ]);
  await record(OTHER, [
    { ruleId: "x", from: "armed", to: "cancelled", at: T0 + 3, reason: "theirs" },
  ]);

  const mine = await transitionsFor(USER);
  assert.deepEqual(
    mine.map((t) => t.to),
    ["firing", "filled"],
  );
  assert.equal(mine[0].price, 205.01);
  assert.equal((await transitionsFor(OTHER)).length, 1);
});

test("transitions written in one tick keep their order, though they share a timestamp", async () => {
  /*
   * THE ONE THE INTEGRATION TEST CAUGHT. Every transition a tick emits is
   * stamped with the same `now` — deliberately, so the trail says when the
   * tick happened. Sorting on `at` alone leaves Postgres free to return them
   * in any order, and it returned `filled` before `firing`: an audit trail
   * showing a rule completing before it started.
   */
  const at = T0 + 7;
  await record(USER, [
    { ruleId: "r1", from: "armed", to: "firing", at, reason: "price crossed", price: 49 },
    { ruleId: "r1", from: "firing", to: "filled", at, reason: "executed", price: 48.9 },
    { ruleId: "r2", from: "armed", to: "cancelled", at, reason: "position closed" },
  ]);

  assert.deepEqual(
    (await transitionsFor(USER)).map((t) => t.reason),
    ["price crossed", "executed", "position closed"],
  );
});

test("a transition with no price omits the field rather than inventing a zero", async () => {
  await record(USER, [{ ruleId: "r1", from: "armed", to: "expired", at: T0, reason: "lapsed" }]);
  const [t] = await transitionsFor(USER);
  assert.equal("price" in t, false);
});

test("the heartbeat is one row, and reading it back gives a timestamp", async () => {
  await beat("11 markets, 0 fired");
  const at = await lastBeat();
  assert.equal(typeof at, "number");
  assert.ok(Math.abs(Date.now() - at!) < 60_000);
  const rows = await h.pg.query("select count(*)::int as n from heartbeat");
  assert.equal((rows.rows[0] as { n: number }).n, 1);
});

/* ──────────────────────────────── prices ───────────────────────────────── */

test("a price is written and read back", async () => {
  await recordPrices([price()]);
  assert.equal((await lastPrices([SOL])).get(SOL), 142.5);
});

test("an older slot never overwrites a newer one", async () => {
  /*
   * Two workers can write the same mint in the same second with prices derived
   * at different slots. Without the guard the later ARRIVAL wins, which is not
   * the same as the later PRICE — the chain's own ordering has to settle it.
   */
  await recordPrices([price({ usd: 142.5, blockId: 300_000_100 })]);
  await recordPrices([price({ usd: 1, blockId: 300_000_000 })]);
  assert.equal((await lastPrices([SOL])).get(SOL), 142.5);

  await recordPrices([price({ usd: 150, blockId: 300_000_101 })]);
  assert.equal((await lastPrices([SOL])).get(SOL), 150);
});

test("lastPrices asks for many mints in one query and skips what it has never seen", async () => {
  await recordPrices([price(), price({ mint: BONK, usd: 0.00002841, blockId: 300_000_001 })]);
  const got = await lastPrices([SOL, BONK, "never-seen"]);
  assert.equal(got.size, 2);
  assert.equal(got.get(BONK), 0.00002841);
});

test("a memecoin price keeps its precision, which is the point of numeric(30,12)", async () => {
  await recordPrices([price({ mint: BONK, usd: 0.000000123456 })]);
  assert.equal((await lastPrices([BONK])).get(BONK), 0.000000123456);
});

test("repeated writes inside one bucket collapse to a single tick", async () => {
  await recordPrices([price({ usd: 142.5 })]);
  await recordPrices([price({ usd: 142.9 })]);
  const ticks = await ticksSince(SOL, 0);
  assert.equal(ticks.length, 1);
  assert.equal(ticks[0].usd, 142.5, "the first sample in a bucket is the one kept");
});

test("ticks come back oldest first and only from the window asked for", async () => {
  await h.pg.exec(`
    insert into price_ticks (mint, bucket, usd, block_id) values
      ('${SOL}', 1000, 10, 1),
      ('${SOL}', 3000, 30, 3),
      ('${SOL}', 2000, 20, 2),
      ('${BONK}', 2000, 99, 2);
  `);
  assert.deepEqual(
    (await ticksSince(SOL, 2000)).map((t) => t.usd),
    [20, 30],
  );
});

/* ─────────────────────────────── the index ─────────────────────────────── */

test("the crossing query uses the partial index rather than reading the table", async () => {
  /*
   * The index is not decoration. Without it every tick scans every rule that
   * has ever existed, including the filled and cancelled ones, forever — and
   * that is a regression nothing else here would catch, because the answers
   * stay correct right up until the product has users.
   */
  await insertRule(USER, rule());
  await h.pg.exec("set enable_seqscan = off;");
  const plan = await h.pg.query<{ "QUERY PLAN": string }>(
    `explain select * from rules where state = 'armed' and market = '${SOL}'
       and ((direction = 'above' and threshold <= 200) or (direction = 'below' and threshold >= 200))`,
  );
  const text = plan.rows.map((r) => r["QUERY PLAN"]).join("\n");
  await h.pg.exec("set enable_seqscan = on;");
  assert.match(text, /rules_watching/);
});
