import { test } from "node:test";
import assert from "node:assert/strict";
import { analyseToken, scan } from "../engine.ts";
import type { Trade, PricePoint } from "../types.ts";

const P = (pts: [number, number][]): PricePoint[] =>
  pts.map(([ts, price]) => ({ ts, price }));

const buy = (ts: number, amount: number, usdValue: number): Trade => ({
  mint: "M", ts, side: "buy", amount, usdValue,
});
const sell = (ts: number, amount: number, usdValue: number): Trade => ({
  mint: "M", ts, side: "sell", amount, usdValue,
});

test("classic round trip: 10x peak, sold near zero", () => {
  const r = analyseToken(
    "M",
    [buy(1, 1000, 1000), sell(6, 1000, 500)],
    P([[1, 1], [2, 5], [3, 10], [4, 6], [5, 3], [6, 0.5]]),
    7,
  )!;
  assert.equal(r.invested, 1000);
  assert.equal(r.realised, 500);
  assert.equal(r.currentValue, 0);
  assert.equal(r.peakValue, 10000);
  assert.equal(r.peakTs, 3);
  assert.equal(r.leftOnTable, 9500);
  assert.equal(r.pnl, -500);
  assert.equal(r.roundTripped, true);
  // -40% trailing stop from a high of 10 fires at 6
  assert.equal(r.stop.exitPrice, 6);
  assert.equal(r.stop.wouldHaveRealised, 6000);
  assert.equal(r.stop.saved, 5500);
});

test("still holding: current value marked at last price", () => {
  const r = analyseToken("M", [buy(1, 100, 200)], P([[1, 2], [2, 3]]), 3)!;
  assert.equal(r.currentValue, 300);
  assert.equal(r.realised, 0);
  assert.equal(r.pnl, 100);
  assert.equal(r.leftOnTable, 0);      // peak IS the current value
  assert.equal(r.roundTripped, false);
  assert.equal(r.stop.saved, 0);        // never dropped 40%
});

test("price only rises: stop never fires, nothing left on table", () => {
  const r = analyseToken(
    "M",
    [buy(1, 10, 100), sell(4, 10, 400)],
    P([[1, 10], [2, 20], [3, 30], [4, 40]]),
    5,
  )!;
  assert.equal(r.stop.firedAt, null);
  assert.equal(r.stop.saved, 0);
  assert.equal(r.pnl, 300);
  assert.equal(r.leftOnTable, 0);
});

test("partial sell then ride to zero", () => {
  const r = analyseToken(
    "M",
    [buy(1, 1000, 1000), sell(3, 500, 5000)],
    P([[1, 1], [2, 5], [3, 10], [4, 1], [5, 0.1]]),
    6,
  )!;
  assert.equal(r.realised, 5000);
  assert.equal(r.currentValue, 50);              // 500 left @ 0.1
  assert.equal(r.peakValue, 10000);              // 1000 tokens @ 10
  assert.equal(r.leftOnTable, 10000 - 5050);
  assert.equal(r.roundTripped, false);           // outcome 5050 > invested
});

test("re-entry resets the trailing stop high-water mark", () => {
  const r = analyseToken(
    "M",
    [buy(1, 100, 100), sell(3, 100, 500), buy(4, 100, 100)],
    P([[1, 1], [2, 3], [3, 5], [4, 1], [5, 2], [6, 1.1]]),
    7,
  )!;
  // Without a reset the old high of 5 would fire instantly at price 1.
  // With the reset, the second position highs at 2 and needs <= 1.2.
  assert.equal(r.stop.exitPrice, 1.1);
  assert.equal(r.stop.firedAt, 6);
});

test("sell larger than known balance is clamped, not negative", () => {
  const r = analyseToken("M", [buy(1, 10, 10), sell(2, 999, 50)], P([[1, 1], [2, 1]]), 3)!;
  assert.equal(r.currentValue, 0);
  assert.equal(r.realised, 50);
});

test("scan aggregates and ranks worst first", () => {
  const s = scan("W", [
    {
      mint: "A",
      trades: [buy(1, 1000, 1000), sell(4, 1000, 500)],
      prices: P([[1, 1], [2, 10], [3, 6], [4, 0.5]]),
    },
    {
      mint: "B",
      trades: [buy(1, 10, 100), sell(3, 10, 120)],
      prices: P([[1, 10], [2, 12], [3, 12]]),
    },
  ]);
  assert.equal(s.tokensAnalysed, 2);
  assert.equal(s.roundTripCount, 1);
  assert.equal(s.worst[0].mint, "A");
  assert.equal(s.totalLeftOnTable, 9500 + 0);
  assert.ok(s.totalStopWouldHaveSaved > 0);
});

test("no price data returns null rather than a wrong number", () => {
  assert.equal(analyseToken("M", [buy(1, 1, 1)], [], 2), null);
  assert.equal(analyseToken("M", [], P([[1, 1]]), 2), null);
});
