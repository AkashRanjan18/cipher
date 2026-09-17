import { test } from "node:test";
import assert from "node:assert/strict";
import { compact, compactUsd, pct, price, since, units, usd } from "../format.ts";

test("prices never render in scientific notation", () => {
  /*
   * toPrecision(4) turns 31650 into "3.165e+4", which on a tape reads as
   * corrupted data. A memecoin at 3e-6 and an $81,000 token share a column.
   */
  for (const n of [31650, 79830, 0.000003193, 1.5, 999_999, 1e-9]) {
    assert.ok(!/e[+-]/i.test(price(n)), `${n} rendered as ${price(n)}`);
  }
});

test("sub-dollar prices keep significant digits, not decimal places", () => {
  // 0.0000030 and 0.0000003 are 10x apart; toFixed(2) collapses both to 0.00.
  assert.equal(price(0.000003193), "0.000003193");
  // A 3.7-cent token does not need nine decimals.
  assert.equal(price(0.037843376), "0.03784");
});

test("compact reaches trillions", () => {
  // Stopping at millions printed "1635553.0M" for BTC's market cap.
  assert.equal(compact(1_634_909_967_818), "1.63T");
  assert.equal(compact(280_955_457), "280.96M");
  assert.equal(compactUsd(null), "—");
});

test("dust is not rounded away to zero", () => {
  // Most of a memecoin tape is sub-dollar; "0" reads as missing data.
  assert.equal(compact(0.62), "0.62");
});

test("a null change is unknown, never flat", () => {
  /*
   * Printing 0.00% for a window the source did not report is a claim about
   * the market that we cannot support.
   */
  assert.equal(pct(null), "—");
  assert.equal(pct(0), "▲0.00%");
  assert.equal(pct(-8.4, false), "-8.40%");
});

test("elapsed time has no value without a client clock", () => {
  // Rendering it during SSR is what caused the hydration mismatch.
  assert.equal(since(1000, null), "");
  assert.equal(since(null, 5_000_000), "");
});

test("elapsed time steps through the units a trader reasons in", () => {
  const now = 10_000_000_000;
  assert.equal(since(now / 1000 - 30, now), "30s");
  assert.equal(since(now / 1000 - 600, now), "10m");
  assert.equal(since(now / 1000 - 7200, now), "2h");
  assert.equal(since(now / 1000 - 172_800, now), "2d");
});

test("usd formats a price, compactUsd abbreviates it", () => {
  assert.equal(usd(105.38), "$105.38");
  // One decimal at thousands, matching how the panels read: $437.0K.
  assert.equal(compactUsd(436_960), "$437.0K");
});

test("a sub-dollar PRICE is never abbreviated", () => {
  /*
   * compact() rounds anything under a dollar to two decimals, which is right
   * for a trade size and catastrophic for a price: BONK at 0.0000032 rendered
   * as "$0.00" in the header. Prices go through usd(), sizes through
   * compactUsd(), and the two are not interchangeable.
   */
  assert.equal(usd(0.0000032), "$0.0000032");
  assert.equal(compactUsd(0.0000032), "$0.00");
});

/*
 * `units` exists because `compact` was doing this job and rounding it away:
 * a sell of 2.5064 SOL rendered as "3 SOL" in the swaps table, next to the
 * price it was sold at. These pin the boundary it must not cross again.
 */
test("units keeps the decimals that are money", () => {
  assert.equal(units(5.012819623), "5.0128");
  assert.equal(units(2.5064), "2.5064");
  // A round number does not grow a tail.
  assert.equal(units(5), "5");
  // Dust under a dollar's worth keeps enough digits to tell a 10x apart.
  assert.equal(units(0.000003), "0.000003");
});

test("units abbreviates only where the units stop mattering", () => {
  assert.equal(units(19_188.44), "19.2K");
  assert.equal(units(19_700_000), "19.70M");
  // Just under the boundary is still exact.
  assert.equal(units(9_999.5), "9,999.5");
});

test("units refuses to print a quantity it does not have", () => {
  assert.equal(units(0), "0");
  assert.equal(units(NaN), "0");
});
