import { test } from "node:test";
import assert from "node:assert/strict";
import { isStale, newestBlock, toMarketPrices, type SolPrice } from "../prices.ts";
import { ALL_MINTS, SOLANA_MARKETS, listedSymbol, marketByMint, SOL_MINT } from "../markets.ts";

const price = (mint: string, usd: number, blockId: number): SolPrice => ({
  mint,
  usd,
  blockId,
  decimals: 9,
  liquidityUsd: 1_000_000,
  change24h: 0,
});

/* ─────────────────────────────── staleness ─────────────────────────────── */

test("a flat market and a dead feed are told apart by the block id", () => {
  /*
   * This is the whole reason blockId is carried. A price that has not moved
   * looks identical to a feed that has stopped — until you can see that the
   * chain advanced and the price did not. Acting on a dead feed is acting
   * blind, and a trigger engine doing that is worse than one that admits it
   * cannot see.
   */
  const head = 446_768_000;
  assert.equal(isStale(price(SOL_MINT, 101, head), head), false, "current");
  assert.equal(isStale(price(SOL_MINT, 101, head - 100), head), false, "40 seconds behind");
  assert.equal(isStale(price(SOL_MINT, 101, head - 5_000), head), true, "half an hour behind");
});

test("an unknown block id never marks a price stale", () => {
  // Refusing to fire because we could not measure freshness would be worse
  // than firing: a missed stop reports nothing.
  assert.equal(isStale(price(SOL_MINT, 101, 0), 446_768_000), false);
  assert.equal(isStale(price(SOL_MINT, 101, 446_768_000), 0), false);
});

test("the newest block in a batch is the reference", () => {
  const m = new Map([
    ["a", price("a", 1, 100)],
    ["b", price("b", 2, 250)],
    ["c", price("c", 3, 175)],
  ]);
  assert.equal(newestBlock(m), 250);
  assert.equal(newestBlock(new Map()), 0);
});

/* ──────────────────────────── the market list ──────────────────────────── */

test("every listed market has a plausible mint and no duplicates", () => {
  const mints = new Set<string>();
  for (const m of SOLANA_MARKETS) {
    // Base58, 32-44 chars. A typo'd mint is a market nobody can trade.
    assert.match(m.mint, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, m.symbol);
    assert.ok(m.decimals >= 0 && m.decimals <= 18, `${m.symbol} decimals`);
    assert.equal(mints.has(m.mint), false, `duplicate mint for ${m.symbol}`);
    mints.add(m.mint);
  }
  assert.equal(mints.size, ALL_MINTS.length);
});

test("markets are found by mint, which is the only unforgeable identity", () => {
  assert.equal(marketByMint(SOL_MINT)?.symbol, "SOL");
  assert.equal(marketByMint("NotAMintAddress"), null);
});

test("symbol lookup answers only for the listed set", () => {
  /*
   * This is NOT token resolution and must never be used as such. It answers
   * "is this one of the markets cipher lists" — anything a user types goes
   * through tokens.ts, which knows the symbol BONK belongs to an impostor
   * with two holders.
   */
  assert.equal(listedSymbol("sol")?.mint, SOL_MINT);
  assert.equal(listedSymbol("  BONK  ")?.symbol, "BONK");
  assert.equal(listedSymbol("PEPE"), null);
});

test("only SOL claims a Binance chart, and the rest admit they have none", () => {
  // A chart for a Solana memecoin has to be built from swap history. Borrowing
  // a pair that does not exist would draw a picture of a different asset.
  const withChart = SOLANA_MARKETS.filter((m) => m.chartPair !== null);
  assert.deepEqual(withChart.map((m) => m.symbol), ["SOL"]);
});

/* ──────────────────────────── the engine's view ────────────────────────── */

test("prices reach the engine keyed by mint", () => {
  const m = new Map([[SOL_MINT, price(SOL_MINT, 101.5, 1)]]);
  assert.deepEqual(toMarketPrices(m), { [SOL_MINT]: 101.5 });
});
