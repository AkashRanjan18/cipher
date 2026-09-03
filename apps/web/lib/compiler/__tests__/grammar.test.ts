import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWithGrammar } from "../grammar.ts";

test("the canonical sentence", () => {
  const s = parseWithGrammar(
    "buy me $500 of bonk, sell a third at 2x and stop the rest at -50%",
  )!;
  assert.equal(s.source, "grammar");
  assert.equal(s.entry!.side, "buy");
  assert.equal(s.entry!.token, "bonk");
  assert.deepEqual(s.entry!.amount, { kind: "usd", value: 500 });

  assert.equal(s.exits.length, 2);
  assert.deepEqual(s.exits[0].trigger, { kind: "priceMultiple", value: 2 });
  assert.deepEqual(s.exits[0].amount, { kind: "percentOfPosition", value: 33 });
  assert.deepEqual(s.exits[1].trigger, { kind: "drawdownFromEntry", percent: 50 });
});

test("defaults are applied when unstated", () => {
  const s = parseWithGrammar("buy $100 of wif")!;
  assert.equal(s.entry!.slippageBps, 300); // 3%
  assert.equal(s.entry!.privateSubmission, true);
});

test("slippage overrides the default", () => {
  const s = parseWithGrammar("buy $100 of wif, max 1.5% slippage")!;
  assert.equal(s.entry!.slippageBps, 150);
});

test("public submission is an explicit opt-out", () => {
  assert.equal(parseWithGrammar("buy $50 of pepe")!.entry!.privateSubmission, true);
  assert.equal(
    parseWithGrammar("buy $50 of pepe with public mempool")!.entry!.privateSubmission,
    false,
  );
});

test("k and m suffixes", () => {
  assert.deepEqual(parseWithGrammar("buy $1.5k of bonk")!.entry!.amount, {
    kind: "usd",
    value: 1500,
  });
  assert.deepEqual(parseWithGrammar("buy $2m of bonk")!.entry!.amount, {
    kind: "usd",
    value: 2_000_000,
  });
});

test("a ladder of take-profits", () => {
  const s = parseWithGrammar("sell a third at 2x, sell a third at 5x")!;
  assert.equal(s.exits.length, 2);
  assert.deepEqual(s.exits[0].trigger, { kind: "priceMultiple", value: 2 });
  assert.deepEqual(s.exits[1].trigger, { kind: "priceMultiple", value: 5 });
});

test("bare take-profit means the whole position", () => {
  const s = parseWithGrammar("take profit at 3x")!;
  assert.deepEqual(s.exits[0].amount, { kind: "percentOfPosition", value: 100 });
});

test("stop sign is ignored — nobody means a stop above entry", () => {
  const a = parseWithGrammar("stop at -40%")!;
  const b = parseWithGrammar("stop at 40%")!;
  assert.deepEqual(a.exits[0].trigger, b.exits[0].trigger);
});

test("trailing stop", () => {
  const s = parseWithGrammar("trail 30%")!;
  assert.deepEqual(s.exits[0].trigger, { kind: "trailingStop", percent: 30 });
});

test("word fractions", () => {
  assert.deepEqual(parseWithGrammar("sell half at 2x")!.exits[0].amount, {
    kind: "percentOfPosition",
    value: 50,
  });
  assert.deepEqual(parseWithGrammar("sell a quarter at 2x")!.exits[0].amount, {
    kind: "percentOfPosition",
    value: 25,
  });
});

test("exit-only sentences parse without an entry", () => {
  const s = parseWithGrammar("stop at -50%")!;
  assert.equal(s.entry, null);
  assert.equal(s.exits.length, 1);
});

test("returns null rather than half-parsing", () => {
  // Nothing recognisable at all.
  assert.equal(parseWithGrammar("what's the weather"), null);
  assert.equal(parseWithGrammar(""), null);
  // Understood shape, impossible value — refuse rather than clamp silently.
  assert.equal(parseWithGrammar("stop at 150%"), null);
  assert.equal(parseWithGrammar("sell 0.5x"), null);
});

test("ids are unique so a ladder can be addressed", () => {
  const s = parseWithGrammar("sell a third at 2x, sell a third at 5x")!;
  assert.notEqual(s.exits[0].id, s.exits[1].id);
});
