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

/* ───────────── the user's own sentences, which did not parse ──────────── */

test("a trailing stop is ONE exit, not a trailing stop plus a drawdown", () => {
  const spec = parseWithGrammar("have a trailing stop loss at 10%");
  assert.ok(spec);
  /*
   * "trailing stop at 10%" contains the literal string "stop at 10%", so the
   * stop pattern matched inside the trailing one and the sentence armed two
   * rules for the whole position. The user would have been sold twice — once
   * at -10% from entry, and again by a stop they never asked for.
   */
  assert.equal(spec.exits.length, 1);
  assert.deepEqual(spec.exits[0].trigger, { kind: "trailingStop", percent: 10 });
});

test("plain 'trailing stop at 10%' is still one exit", () => {
  const spec = parseWithGrammar("trailing stop at 10%");
  assert.ok(spec);
  assert.equal(spec.exits.length, 1);
  assert.deepEqual(spec.exits[0].trigger, { kind: "trailingStop", percent: 10 });
});

test("a stop can name the market in the middle of the sentence", () => {
  for (const sentence of [
    "stop SOL at -50%",
    "stop loss on solana at 50%",
    "put a stop loss on solana at 50% of the buying price",
  ]) {
    const spec = parseWithGrammar(sentence);
    assert.ok(spec, sentence);
    assert.deepEqual(
      spec.exits.map((e) => e.trigger),
      [{ kind: "drawdownFromEntry", percent: 50 }],
      sentence,
    );
  }
});

test("naming the market does not eat the trigger", () => {
  // "at" is two letters, so a token pattern that does not exclude it swallows
  // the word the percentage hangs off and the sentence stops parsing.
  const spec = parseWithGrammar("stop at 25%");
  assert.ok(spec);
  assert.deepEqual(spec.exits[0].trigger, { kind: "drawdownFromEntry", percent: 25 });
  assert.deepEqual(spec.exits[0].amount, { kind: "percentOfPosition", value: 100 });
});

test("a ladder and a stop in one sentence still produce exactly two exits", () => {
  const spec = parseWithGrammar("sell a third at 2x, stop the rest at -50%");
  assert.ok(spec);
  assert.equal(spec.exits.length, 2);
});

/* ───────────────────── limit orders, both directions ──────────────────── */

test("a price on an entry makes it rest instead of filling", () => {
  const spec = parseWithGrammar("buy $500 of solana at $95");
  assert.ok(spec);
  assert.deepEqual(spec.entry?.trigger, { kind: "priceAbsolute", value: 95 });
});

test("a limit SELL stays a sell", () => {
  const spec = parseWithGrammar("sell 2 sol at $120");
  assert.ok(spec);
  // armEntry hardcoded side: "buy", so this armed a BUY at $120 — you ask to
  // sell and it buys. The worst shape a resting order can have.
  assert.equal(spec.entry?.side, "sell");
  assert.deepEqual(spec.entry?.trigger, { kind: "priceAbsolute", value: 120 });
});

test("a plain market order still has no trigger", () => {
  assert.equal(parseWithGrammar("buy $500 of solana")?.entry?.trigger, null);
});

test("'at 2x' and 'at 50%' are never read as prices", () => {
  // Both would otherwise land here as $2 and $50.
  assert.equal(parseWithGrammar("buy $500 of sol, sell half at 2x")?.entry?.trigger, null);
  assert.equal(parseWithGrammar("buy $500 of sol, stop at -50%")?.entry?.trigger, null);
});

test("an exit can name a price, not just a multiple", () => {
  const spec = parseWithGrammar("sell half at $200");
  assert.ok(spec);
  assert.deepEqual(spec.exits[0].trigger, { kind: "priceAbsolute", value: 200 });
  assert.deepEqual(spec.exits[0].amount, { kind: "percentOfPosition", value: 50 });
});

test("a resting entry and a priced exit in one sentence stay separate", () => {
  const spec = parseWithGrammar("buy $500 of sol at $95, sell half at $200");
  assert.ok(spec);
  // The FIRST price belongs to the entry, the second to the exit. Reading
  // them the other way round buys at $200 and sells at $95.
  assert.deepEqual(spec.entry?.trigger, { kind: "priceAbsolute", value: 95 });
  assert.deepEqual(spec.exits[0].trigger, { kind: "priceAbsolute", value: 200 });
});

test("a bare number after 'at' on an exit is not guessed at", () => {
  // "sell half at 200" — dollars, percent, or a multiple? The dollar sign is
  // required, and the bare form falls through to the router's clarify.
  const spec = parseWithGrammar("sell half at 200");
  assert.equal(spec?.exits.length ?? 0, 0);
});
