import { test } from "node:test";
import assert from "node:assert/strict";
import { isBonding, graduationProgress } from "../bonding.ts";

test("pumpswap is NOT bonding — it is where graduates land", () => {
  /*
   * The single mistake that would poison the tab: treating the destination
   * DEX as a curve puts already-graduated tokens in the pre-graduation list.
   */
  assert.ok(isBonding("pump-fun"));
  assert.ok(isBonding("meteora-dbc"));
  assert.ok(!isBonding("pumpswap"));
  assert.ok(!isBonding("raydium"));
  assert.ok(!isBonding("orca"));
});

test("graduation progress is a share of the threshold", () => {
  assert.equal(graduationProgress(69_000), 100);
  assert.equal(graduationProgress(34_500), 50);
});

test("progress clamps at 100", () => {
  // A token can exceed the threshold before the migration lands, and a
  // 112% bar reads as a bug.
  assert.equal(graduationProgress(200_000), 100);
});

test("no market cap means no bar, not a zero bar", () => {
  /*
   * An empty bar reads as "just launched". A token we know nothing about is
   * a different trade from one at 0%, so it must render nothing at all.
   */
  assert.equal(graduationProgress(null), null);
  assert.equal(graduationProgress(0), null);
});
