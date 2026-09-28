import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { preview } from "../preview.ts";

/*
 * A stubbed Jupiter over ONE constant-product pool: $10,000 against
 * 1,000,000 tokens (price $0.01), with a 1% fee on the way in — the example
 * used to explain the fomo "$500 → $468" complaint. The preview has to report
 * what that pool actually does to a $500 buy, before the buy.
 */
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const TOKEN = "T".repeat(40);
const realFetch = globalThis.fetch;

function swap(dollarsIn: boolean, amountIn: number): number {
  const x = 10_000;
  const y = 1_000_000;
  const net = amountIn * 0.99;
  return dollarsIn ? y - (x * y) / (x + net) : x - (x * y) / (y + net);
}

before(() => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const inputMint = url.searchParams.get("inputMint");
    const amount = Number(url.searchParams.get("amount"));
    const buying = inputMint === USDC;
    /* USDC has 6 decimals; the token is given 6 here too. */
    const out = swap(buying, amount / 1e6) * 1e6;
    return new Response(
      JSON.stringify({ inAmount: String(amount), outAmount: String(Math.floor(out)), otherAmountThreshold: "0", routePlan: [] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
});

after(() => {
  globalThis.fetch = realFetch;
});

test("a $500 buy into a $10k pool is shown worth about $472 before it happens", async () => {
  const p = await preview({ mint: TOKEN, decimals: 6, side: "buy", size: 500, mark: 0.01 });
  assert.ok(Math.abs(p.out - 47_166) < 5, `tokens ${p.out}`);
  assert.ok(Math.abs(p.worthNowUsd - 471.66) < 0.1, `worth ${p.worthNowUsd}`);
  assert.ok(p.costPct > 5 && p.costPct < 6, `cost ${p.costPct}`);
});

test("a small buy into the same pool costs about the fee and little else", async () => {
  const p = await preview({ mint: TOKEN, decimals: 6, side: "buy", size: 10, mark: 0.01 });
  assert.ok(p.costPct < 1.2, `cost ${p.costPct}`);
});

test("a sell reports the dollars it gets and how far under the market that is", async () => {
  const p = await preview({ mint: TOKEN, decimals: 6, side: "sell", size: 50_000, mark: 0.01 });
  assert.ok(p.out < 500 && p.out > 450, `dollars ${p.out}`);
  assert.ok(p.costPct > 1, `cost ${p.costPct}`);
});
