import { test } from "node:test";
import assert from "node:assert/strict";
import { ORDER_SPEC_VERSION, type OrderSpec } from "@cipher/shared";
import { validateOrder, blocks, type ValidationContext } from "../validate.ts";

/**
 * The validator is the last thing between a misparse and a real order, so the
 * tests are written as the situations they prevent rather than as coverage of
 * its branches.
 */

const flat: ValidationContext = { cashUsd: 10_000, position: 0, price: 100 };
const holding: ValidationContext = { cashUsd: 500, position: 20, price: 100 };

function spec(over: Partial<OrderSpec> = {}): OrderSpec {
  return {
    version: ORDER_SPEC_VERSION,
    entry: null,
    exits: [],
    source: "grammar",
    warnings: [],
    ...over,
  };
}

function buy(over: Partial<NonNullable<OrderSpec["entry"]>> = {}) {
  return {
    side: "buy" as const,
    token: "sol",
    mint: "So11111111111111111111111111111111111111112",
    amount: { kind: "usd" as const, value: 500 },
    slippageBps: 300,
    privateSubmission: true,
    ...over,
  };
}

test("a clean buy raises nothing", () => {
  assert.deepEqual(validateOrder(spec({ entry: buy() }), flat), []);
});

test("a buy larger than the balance is refused, and says by how much", () => {
  const p = validateOrder(spec({ entry: buy({ amount: { kind: "usd", value: 25_000 } }) }), flat);
  assert.ok(blocks(p));
  assert.match(p[0].message, /\$25,000 and you have \$10,000/);
});

test("an unresolved token warns but does not block", () => {
  const p = validateOrder(spec({ entry: buy({ mint: null }) }), flat);
  assert.equal(blocks(p), false);
  assert.equal(p[0].at, "token");
});

test("selling with no position is refused", () => {
  const p = validateOrder(
    spec({ entry: buy({ side: "sell", amount: { kind: "percentOfPosition", value: 100 } }) }),
    flat,
  );
  assert.ok(blocks(p));
});

/*
 * The typo that costs real money: 500 meaning 5.00%, parsed as 500%.
 * Anything that wide is not a tolerance, and the message has to name the
 * number the user almost certainly meant.
 */
test("absurd slippage is refused and suggests the decimal", () => {
  const p = validateOrder(spec({ entry: buy({ slippageBps: 50_000 }) }), flat);
  assert.ok(blocks(p));
  assert.match(p[0].message, /5\.00%/);
});

test("wide-but-plausible slippage warns instead of blocking", () => {
  const p = validateOrder(spec({ entry: buy({ slippageBps: 2_000 }) }), flat);
  assert.equal(blocks(p), false);
  assert.equal(p[0].at, "slippage");
});

/*
 * "Take profit at 0.8x" is an inverted stop. Arming it would sell the user out
 * at a loss under a readback that says the word "profit".
 */
test("a take-profit below entry is refused as not a profit", () => {
  const p = validateOrder(
    spec({
      exits: [
        { id: "a", trigger: { kind: "priceMultiple", value: 0.8 }, amount: { kind: "percentOfPosition", value: 100 } },
      ],
    }),
    holding,
  );
  assert.ok(blocks(p));
  assert.match(p[0].message, /not a profit/);
});

test("a stop of 100% or more is refused", () => {
  const p = validateOrder(
    spec({
      exits: [
        { id: "a", trigger: { kind: "drawdownFromEntry", percent: 100 }, amount: { kind: "percentOfPosition", value: 100 } },
      ],
    }),
    holding,
  );
  assert.ok(blocks(p));
});

/*
 * A LADDER IS NOT AN OVERSELL. percentOfPosition is a share of the position at
 * FIRE time, so half, then half of the rest, then half of that is 87.5% of the
 * original — not 150%. This test exists to stop someone "fixing" that later by
 * summing the percentages.
 */
test("a ladder of three halves is valid, not an oversell", () => {
  const p = validateOrder(
    spec({
      exits: [2, 3, 4].map((x, i) => ({
        id: `e${i}`,
        trigger: { kind: "priceMultiple" as const, value: x },
        amount: { kind: "percentOfPosition" as const, value: 50 },
      })),
    }),
    holding,
  );
  assert.deepEqual(p, []);
});

test("a single exit over 100% is refused", () => {
  const p = validateOrder(
    spec({
      exits: [
        { id: "a", trigger: { kind: "priceMultiple", value: 2 }, amount: { kind: "percentOfPosition", value: 140 } },
      ],
    }),
    holding,
  );
  assert.ok(blocks(p));
});

test("a fixed stop and a trailing stop warn about each other", () => {
  const p = validateOrder(
    spec({
      exits: [
        { id: "a", trigger: { kind: "drawdownFromEntry", percent: 50 }, amount: { kind: "percentOfPosition", value: 100 } },
        { id: "b", trigger: { kind: "trailingStop", percent: 30 }, amount: { kind: "percentOfPosition", value: 100 } },
      ],
    }),
    holding,
  );
  assert.equal(blocks(p), false);
  assert.match(p[0].message, /whichever is hit first/i);
});

test("two whole-position stops warn that the second is unreachable", () => {
  const p = validateOrder(
    spec({
      exits: [
        { id: "a", trigger: { kind: "drawdownFromEntry", percent: 40 }, amount: { kind: "percentOfPosition", value: 100 } },
        { id: "b", trigger: { kind: "drawdownFromEntry", percent: 60 }, amount: { kind: "percentOfPosition", value: 100 } },
      ],
    }),
    holding,
  );
  assert.equal(blocks(p), false);
  assert.ok(p.some((x) => /only the first one can ever fire/.test(x.message)));
});

test("exits alone with no position and no entry are refused", () => {
  const p = validateOrder(
    spec({
      exits: [
        { id: "a", trigger: { kind: "priceMultiple", value: 2 }, amount: { kind: "percentOfPosition", value: 50 } },
      ],
    }),
    flat,
  );
  assert.ok(blocks(p));
  assert.match(p.at(-1)!.message, /no position/);
});

/* Exits are allowed to reference a position that does not exist yet — they
   bind to the entry's fill. Refusing this would break the single most common
   sentence the product exists to handle. */
test("exits attached to a new buy are fine while flat", () => {
  const p = validateOrder(
    spec({
      entry: buy(),
      exits: [
        { id: "a", trigger: { kind: "priceMultiple", value: 2 }, amount: { kind: "percentOfPosition", value: 33 } },
        { id: "b", trigger: { kind: "drawdownFromEntry", percent: 50 }, amount: { kind: "percentOfPosition", value: 100 } },
      ],
    }),
    flat,
  );
  assert.deepEqual(p, []);
});

test("an empty spec is refused rather than passing silently", () => {
  assert.ok(blocks(validateOrder(spec(), flat)));
});

test("every problem is reported, not just the first", () => {
  const p = validateOrder(
    spec({
      entry: buy({ amount: { kind: "usd", value: 99_999 }, slippageBps: 50_000, mint: null }),
    }),
    flat,
  );
  assert.ok(p.length >= 3);
});
