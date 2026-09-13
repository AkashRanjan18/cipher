import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { Rule } from "@cipher/shared";
import { database, type Harness } from "../../db/__tests__/harness.ts";
import { ensureUser, loadAccount } from "../../db/accounts.ts";
import { insertRule, rulesFor, transitionsFor, lastBeat } from "../../db/rules.ts";
import { lastPrices } from "../../db/prices.ts";
import { tick } from "../worker.ts";

/**
 * The worker, end to end, with the browser closed.
 *
 * A real Postgres underneath and a fake price feed on top — which is the right
 * way round. The feed is the only part that must be faked, because a test that
 * depends on what SOL costs today is a test that fails on a quiet afternoon;
 * everything else is the code that will run in production, including the SQL.
 *
 * These are the cases that only show up when the pieces are assembled: a stale
 * slot, two workers overlapping on one rule, a fill that binds the exits armed
 * alongside it, an expiry racing a crossing.
 */

const SOL = "So11111111111111111111111111111111111111112";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const T0 = 1_700_000_000_000;
const USER = "did:privy:alice";
const HEAD = 300_000_000;

let h: Harness;
const realFetch = globalThis.fetch;

/** What the fake Jupiter serves this test, by mint. */
let feed = new Map<string, { usd: number; blockId: number }>();

function serve(prices: Record<string, number | { usd: number; blockId: number }>): void {
  feed = new Map(
    Object.entries(prices).map(([mint, v]) => [
      mint,
      typeof v === "number" ? { usd: v, blockId: HEAD } : v,
    ]),
  );
}

before(async () => {
  h = await database();

  /*
   * The feed is stubbed at `fetch` rather than by injecting a price source,
   * so `lib/chain/prices.ts` — the chunking, the block id, the shape of
   * Jupiter's response — is under test too. A stub one layer higher would have
   * skipped exactly the parsing most likely to be wrong.
   */
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    assert.match(url.hostname, /jup\.ag$/, `worker reached an unexpected host: ${url.host}`);
    const asked = (url.searchParams.get("ids") ?? "").split(",").filter(Boolean);
    const body: Record<string, unknown> = {};
    for (const mint of asked) {
      const p = feed.get(mint);
      if (!p) continue;
      body[mint] = {
        usdPrice: p.usd,
        blockId: p.blockId,
        decimals: 9,
        priceChange24h: 0,
        liquidity: 1_000_000,
      };
    }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
});

after(async () => {
  globalThis.fetch = realFetch;
  await h.close();
});

beforeEach(async () => {
  await h.reset();
  await ensureUser(USER);
  serve({ [SOL]: 100 });
});

/** Give the user something to sell. The ledger holds one asset today. */
async function position(sol: number, costBasis: number): Promise<void> {
  await h.pg.query("update accounts set sol = $1, cost_basis = $2 where user_id = $3", [
    sol,
    costBasis,
    USER,
  ]);
}

function rule(over: Partial<Rule> = {}): Rule {
  return {
    version: 1,
    id: "r1",
    market: SOL,
    side: "sell",
    parentId: null,
    trigger: { kind: "drawdownFromEntry", percent: 50 },
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

async function stateOf(id: string): Promise<string> {
  const rows = await h.pg.query<{ state: string }>("select state from rules where id = $1", [id]);
  return rows.rows[0]?.state ?? "gone";
}

/* ─────────────────────────── the thing it exists for ───────────────────── */

test("a stop fires with nobody watching, and the money moves", async () => {
  await position(10, 1000);
  await insertRule(USER, rule());
  serve({ [SOL]: 49 });

  const out = await tick(T0 + 1000);

  assert.deepEqual(out.fired, ["r1"]);
  assert.equal(await stateOf("r1"), "filled");

  const account = (await loadAccount(USER))!;
  assert.equal(account.sol, 0, "the whole position should have been sold");
  assert.ok(account.usdc > 10_000, "proceeds never reached the balance");
  assert.equal(account.fills.length, 1);
  assert.equal(account.fills[0].side, "sell");
  assert.equal(account.fills[0].squawk, "stop at -50%");

  const trail = await transitionsFor(USER);
  assert.deepEqual(
    trail.map((t) => t.to),
    ["firing", "filled"],
  );
  assert.equal(trail[0].price, 49, "the audit trail must carry the price that caused it");
});

test("a price that has not crossed anything does nothing, loudly enough to prove it ran", async () => {
  await position(10, 1000);
  await insertRule(USER, rule());
  serve({ [SOL]: 90 });

  const out = await tick(T0 + 1000);
  assert.deepEqual(out.fired, []);
  assert.equal(out.markets, 1);
  assert.equal(await stateOf("r1"), "armed");
  assert.ok((await lastBeat())! > 0, "the heartbeat is how the UI knows rules are watched");
});

test("what the tick saw is written down, because the feed is evidence too", async () => {
  await position(10, 1000);
  await insertRule(USER, rule());
  serve({ [SOL]: 90 });
  await tick(T0 + 1000);

  // recordPrices is deliberately not awaited inside the worker.
  await new Promise((r) => setTimeout(r, 50));
  assert.equal((await lastPrices([SOL])).get(SOL), 90);
});

/* ───────────────────────────── refusing to guess ───────────────────────── */

test("a market with armed rules and no price is skipped, never assumed", async () => {
  await position(10, 1000);
  await insertRule(USER, rule());
  serve({});

  const out = await tick(T0 + 1000);
  assert.deepEqual(out.skipped, [SOL]);
  assert.deepEqual(out.fired, []);
  assert.equal(await stateOf("r1"), "armed");
});

test("a stalled feed is skipped even though the number would have fired", async () => {
  /*
   * The price says 49 and the stop is at 50, so the naive worker sells. The
   * slot says this quote was derived two minutes and three hundred blocks ago,
   * while the chain has moved on — which is a dead feed, not a crash. Acting
   * on it is acting blind, and the conservative direction is the only one
   * that is recoverable.
   */
  await position(10, 1000);
  await insertRule(USER, rule());
  await insertRule(USER, rule({ id: "r2", market: BONK, entryPrice: 0.00002 }));
  serve({
    [SOL]: { usd: 49, blockId: HEAD - 5_000 },
    [BONK]: { usd: 0.00002, blockId: HEAD },
  });

  const out = await tick(T0 + 1000);
  assert.deepEqual(out.skipped, [SOL]);
  assert.deepEqual(out.fired, []);
  assert.equal(await stateOf("r1"), "armed", "a stale feed must not fire a stop");
});

/* ──────────────────────────────  exactly once ──────────────────────────── */

test("two workers overlapping on the same crossing produce exactly one fill", async () => {
  /*
   * The real shape of the bug: a cron that overruns and a second invocation
   * starting before the first finishes. Both read the same armed rule. Only
   * the one whose UPDATE changed a row may trade — everything else about the
   * design is downstream of this holding.
   */
  await position(10, 1000);
  await insertRule(USER, rule());
  serve({ [SOL]: 49 });

  const [a, b] = await Promise.all([tick(T0 + 1000), tick(T0 + 1001)]);

  assert.equal(a.fired.length + b.fired.length, 1);
  assert.equal((await loadAccount(USER))!.fills.length, 1);
});

/* ─────────────────────────── entries and their exits ───────────────────── */

test("a resting buy fills and binds only the exits armed with it", async () => {
  await insertRule(
    USER,
    rule({
      id: "entry",
      side: "buy",
      trigger: { kind: "priceAbsolute", value: 95 },
      amount: { kind: "tokens", value: 5 },
      entryPrice: 100,
    }),
  );
  await insertRule(
    USER,
    rule({
      id: "mine",
      state: "unbound",
      entryPrice: null,
      parentId: "entry",
      trigger: { kind: "priceMultiple", value: 2 },
    }),
  );
  await insertRule(
    USER,
    rule({
      id: "someone-elses-order",
      state: "unbound",
      entryPrice: null,
      parentId: "other-entry",
      trigger: { kind: "priceMultiple", value: 2 },
    }),
  );

  serve({ [SOL]: 94 });
  const out = await tick(T0 + 1000);

  assert.deepEqual(out.fired, ["entry"]);
  assert.equal(await stateOf("mine"), "armed");
  assert.equal(
    await stateOf("someone-elses-order"),
    "unbound",
    "an exit bound to another entry was claimed by this fill",
  );

  const bound = (await rulesFor(USER)).find((r) => r.id === "mine")!;
  assert.ok(bound.entryPrice! > 0, "the child must be bound to what was actually paid");
  assert.ok(bound.entryPrice! < 95, "bound to the limit rather than to the fill");
});

test("a limit buy does not fill above the price the user named", async () => {
  await insertRule(
    USER,
    rule({
      id: "entry",
      side: "buy",
      trigger: { kind: "priceAbsolute", value: 95 },
      amount: { kind: "tokens", value: 5 },
      entryPrice: 100,
    }),
  );
  /* Crossed, but only just — the spread puts the fill on the wrong side of
     the limit, which is a no-fill and not a failure. */
  serve({ [SOL]: 95 });

  const out = await tick(T0 + 1000);
  assert.deepEqual(out.fired, []);
  assert.equal(await stateOf("entry"), "armed", "a missed limit must rest, not die");

  /* Last, not first: the trail opens with the crossing that woke the rule. */
  assert.match((await transitionsFor(USER)).at(-1)!.reason, /above your limit/);
});

test("a sell that empties the position cancels the exits that outlived it", async () => {
  await position(10, 1000);
  await insertRule(USER, rule({ id: "stop" }));
  await insertRule(USER, rule({ id: "target", trigger: { kind: "priceMultiple", value: 5 } }));
  await insertRule(USER, rule({ id: "rebuy", side: "buy", trigger: { kind: "priceAbsolute", value: 40 } }));

  serve({ [SOL]: 49 });
  await tick(T0 + 1000);

  assert.equal(await stateOf("stop"), "filled");
  assert.equal(
    await stateOf("target"),
    "cancelled",
    "a 5x target measured from an entry that no longer exists would sell a re-entry",
  );
  assert.equal(await stateOf("rebuy"), "armed", "being flat is the state a resting buy exists to end");
});

/* ──────────────────────────── clock and authority ──────────────────────── */

test("a timed exit fires on the clock, with no crossing at all", async () => {
  await position(10, 1000);
  await insertRule(USER, rule({ trigger: { kind: "duration", seconds: 3600 } }));
  serve({ [SOL]: 100 });

  assert.deepEqual((await tick(T0 + 3_599_000)).fired, []);
  assert.deepEqual((await tick(T0 + 3_600_000)).fired, ["r1"]);
  assert.equal((await loadAccount(USER))!.sol, 0);
});

test("authority that has lapsed expires the rule and says so in the trail", async () => {
  await position(10, 1000);
  await insertRule(USER, rule({ expiresAt: T0 + 500 }));
  serve({ [SOL]: 90 });

  const out = await tick(T0 + 1000);
  assert.deepEqual(out.expired, ["r1"]);
  assert.equal(await stateOf("r1"), "expired");
  assert.match((await transitionsFor(USER))[0].reason, /authority expired/);
});

test("a rule due in the same tick its authority lapses still fires", async () => {
  /*
   * Expiry runs LAST on purpose. The instruction was due, and the permission
   * was valid at the moment it became due; the other order silently drops an
   * order that was owed.
   */
  await position(10, 1000);
  await insertRule(USER, rule({ trigger: { kind: "duration", seconds: 10 }, expiresAt: T0 + 10_000 }));
  serve({ [SOL]: 100 });

  const out = await tick(T0 + 10_000);
  assert.deepEqual(out.fired, ["r1"]);
  assert.deepEqual(out.expired, []);
});

/* ───────────────────────────── moot and retries ────────────────────────── */

test("a stop on a position that was closed by hand is cancelled, not failed", async () => {
  /*
   * Three retries and a failure notice for a trade that was never owed is the
   * difference between `moot` and `failed`, and it is the kind of thing a user
   * reads as the product being broken.
   */
  await position(0, 0);
  await insertRule(USER, rule());
  serve({ [SOL]: 49 });

  await tick(T0 + 1000);
  assert.equal(await stateOf("r1"), "cancelled");
  assert.match((await transitionsFor(USER)).at(-1)!.reason, /already closed/);
});

test("a limit sell that keeps missing retries, then gives up", async () => {
  await position(10, 1000);
  await insertRule(
    USER,
    rule({ trigger: { kind: "priceAbsolute", value: 150 }, amount: { kind: "percentOfPosition", value: 100 } }),
  );
  /* Above the limit so it is crossed, but the spread lands the fill below it. */
  serve({ [SOL]: 150 });

  await tick(T0 + 1000);
  assert.equal(await stateOf("r1"), "armed");
  await tick(T0 + 2000);
  assert.equal(await stateOf("r1"), "armed");
  await tick(T0 + 3000);
  assert.equal(await stateOf("r1"), "failed", "a rule must not retry forever");

  const reasons = (await transitionsFor(USER)).map((t) => t.reason);
  assert.ok(reasons.some((r) => /retry 1/.test(r)));
  assert.ok(reasons.some((r) => /gave up after 3/.test(r)));
});

/* ──────────────────────────────── trailing ─────────────────────────────── */

test("a new high moves the stop up instead of firing it", async () => {
  /*
   * 300 beats the high AND is above the old threshold of 80. If crossings were
   * checked before highs, this tick would fire a trailing stop on a 3x.
   */
  await position(10, 1000);
  await insertRule(USER, rule({ trigger: { kind: "trailingStop", percent: 20 }, highWater: 100 }));
  serve({ [SOL]: 300 });

  assert.deepEqual((await tick(T0 + 1000)).fired, []);

  serve({ [SOL]: 241 });
  assert.deepEqual((await tick(T0 + 2000)).fired, [], "the stop should now sit at 240");

  serve({ [SOL]: 239 });
  assert.deepEqual((await tick(T0 + 3000)).fired, ["r1"]);
});

/* ──────────────────────────────── isolation ────────────────────────────── */

test("one tick serves every user, and charges each their own account", async () => {
  const BOB = "did:privy:bob";
  await ensureUser(BOB);
  await position(10, 1000);
  await h.pg.query("update accounts set sol = 4, cost_basis = 400 where user_id = $1", [BOB]);

  await insertRule(USER, rule({ id: "alice" }));
  await insertRule(BOB, rule({ id: "bob" }));
  serve({ [SOL]: 49 });

  const out = await tick(T0 + 1000);
  assert.deepEqual(out.fired.sort(), ["alice", "bob"]);
  assert.equal(out.markets, 1, "two users on one market is still one price fetch");
  assert.equal((await loadAccount(USER))!.fills[0].qty, 10);
  assert.equal((await loadAccount(BOB))!.fills[0].qty, 4);
});
