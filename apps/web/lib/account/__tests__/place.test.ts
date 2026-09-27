import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { Rule } from "@cipher/shared";
import { database, type Harness } from "../../db/__tests__/harness.ts";
import { ensureUser, loadAccount } from "../../db/accounts.ts";
import { insertRule } from "../../db/rules.ts";
import { placeTrade } from "../place.ts";

/**
 * A person's trade, end to end against a real Postgres and a stubbed Jupiter.
 *
 * This logic lived in app/api/trade/route.ts until 27 Sep 2026, where nothing
 * could test it — which is how a made-up mint printing paper money went
 * unnoticed. Each test below pins one thing that review found.
 */

const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const FAKE = "A".repeat(40);
const USER = "did:privy:alice";
const T0 = 1_700_000_000_000;

let h: Harness;
const realFetch = globalThis.fetch;
/** What Jupiter knows. A mint missing from here has no price and no route. */
let feed: Record<string, number> = {};

before(async () => {
  h = await database();
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname.includes("/swap/v1/quote")) {
      const inputMint = url.searchParams.get("inputMint") ?? "";
      const outputMint = url.searchParams.get("outputMint") ?? "";
      const amount = Number(url.searchParams.get("amount") ?? "0");
      const buying = inputMint === USDC;
      const px = feed[buying ? outputMint : inputMint];
      if (!px) return new Response("{}", { status: 400 });
      const out = buying ? (amount / 1e6 / px) * 1e9 : (amount / 1e9) * px * 1e6;
      return new Response(
        JSON.stringify({
          inputMint,
          outputMint,
          inAmount: String(Math.round(amount)),
          outAmount: String(Math.round(out)),
          otherAmountThreshold: String(Math.round(out * 0.97)),
          priceImpactPct: "0",
          slippageBps: 300,
          routePlan: [{ swapInfo: { label: "Stub" }, percent: 100 }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    const body: Record<string, unknown> = {};
    for (const mint of (url.searchParams.get("ids") ?? "").split(",").filter(Boolean)) {
      if (feed[mint]) {
        body[mint] = { usdPrice: feed[mint], blockId: 1, decimals: 9, priceChange24h: 0, liquidity: 1e6 };
      }
    }
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
});

after(async () => {
  globalThis.fetch = realFetch;
  await h.close();
});

beforeEach(async () => {
  await h.reset();
  await ensureUser(USER);
  await h.pg.query(`update accounts set usdc = 10000 where user_id = $1`, [USER]);
  feed = { [SOL]: 100 };
});

test("a mint Jupiter cannot price is refused, and no money is made from it", async () => {
  /* The exploit: buy a made-up coin at a tiny client price, sell it at a
     big one. With no server price there is now no trade at all. */
  const buy = await placeTrade(USER, { mint: FAKE, side: "buy", qty: 1e8, mark: 1e-6 });
  assert.ok(buy && "refusal" in buy);
  const sell = await placeTrade(USER, { mint: FAKE, side: "sell", qty: 1e8, mark: 1 });
  assert.ok(sell && "refusal" in sell);
  assert.equal((await loadAccount(USER, false))!.usdc, 10_000);
});

test("a buy spends the dollars typed, and fills at the route's price, not the client's", async () => {
  /* The client typed $500 while its chart showed $101; the route says $100.
     The client sized 4.95 SOL of notional from its own price — the dollars
     are what count, and the quote decides how much SOL they buy. */
  const qty = 500 / 1.005 / 101;
  const r = await placeTrade(USER, { mint: SOL, side: "buy", qty, mark: 101 });
  assert.ok(r && "fill" in r, JSON.stringify(r));
  if (!r || !("fill" in r)) return;
  assert.ok(Math.abs(r.fill.price - 100) < 1e-6, `filled at ${r.fill.price}`);
  const spent = 10_000 - (await loadAccount(USER, false))!.usdc;
  assert.ok(Math.abs(spent - 500) < 0.5, `spent ${spent}`);
});

test("selling the whole position retires its armed exits, and leaves ones waiting on a resting buy", async () => {
  await h.pg.query(
    `insert into positions (user_id, mint, qty, cost_basis) values ($1, $2, 5, 100)`,
    [USER, SOL],
  );
  const base: Rule = {
    version: 1,
    id: "stop",
    market: SOL,
    side: "sell",
    parentId: null,
    trigger: { kind: "drawdownFromEntry", percent: 20 },
    amount: { kind: "percentOfPosition", value: 100 },
    state: "armed",
    armedAt: T0,
    expiresAt: T0 + 7 * 86_400_000,
    entryPrice: 100,
    highWater: null,
    attempts: 0,
  };
  await insertRule(USER, base);
  await insertRule(USER, { ...base, id: "waiting", state: "unbound", entryPrice: null, parentId: "resting-buy" });

  const r = await placeTrade(USER, { mint: SOL, side: "sell", qty: 5, mark: 100 });
  assert.ok(r && "fill" in r, JSON.stringify(r));

  const states = await h.pg.query<{ id: string; state: string }>("select id, state from rules order by id");
  assert.deepEqual(
    Object.fromEntries(states.rows.map((row) => [row.id, row.state])),
    { stop: "cancelled", waiting: "unbound" },
  );
});
