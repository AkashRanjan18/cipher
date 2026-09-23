import { test } from "node:test";
import assert from "node:assert/strict";
import { compile } from "../compile.ts";
import type { CompileContext } from "@cipher/shared";

/**
 * Incomplete orders ask instead of refusing, and complete ones still fill.
 *
 * WHY THIS FILE IS LONGER THAN IT LOOKS IT NEEDS TO BE. While writing the
 * feature, a regex in grammar.ts had its word boundaries replaced by literal
 * backspace bytes, which made three whole branches unmatchable — "sell half of
 * my SOL", "sell all my SOL" and "sell my position on SOL" all came back as
 * "I didn't get that". Every one of the 270 tests still passed, because not
 * one of them typed a sentence a person would type. The suite was measuring
 * the parts and never the product.
 *
 * So the cases below are written as SENTENCES, not as parser internals. If a
 * phrasing is claimed to work it appears here verbatim, and the round-trip
 * tests at the bottom prove the answer to a question produces a real order
 * rather than another question.
 */

const ctx: CompileContext = {
  symbol: "So11111111111111111111111111111111111111112",
  interval: "1h",
  hasPosition: true,
};

const kind = (s: string) => compile(s, ctx).intent.kind;

function order(s: string) {
  const i = compile(s, ctx).intent;
  assert.equal(i.kind, "order", `"${s}" should be an order, got ${i.kind}`);
  if (i.kind !== "order") throw new Error("unreachable");
  return i.spec;
}

function question(s: string) {
  const i = compile(s, ctx).intent;
  assert.equal(i.kind, "clarify", `"${s}" should ask, got ${i.kind}`);
  if (i.kind !== "clarify") throw new Error("unreachable");
  return i;
}

/* ─────────────────────────── market orders fill ─────────────────────────── */

test("the plainest market orders all compile", () => {
  /* These four are the sentences a person types on day one. Three of them
     used to refuse: `sell $200` had no branch at all because the dollar regex
     was hardcoded to `buy`, and "sell my position" had none either. */
  const cases: [string, "buy" | "sell", unknown][] = [
    ["buy me $500 of solana at the current price", "buy", { kind: "usd", value: 500 }],
    ["sell $200 of solana at the current market price", "sell", { kind: "usd", value: 200 }],
    ["sell my position on solana", "sell", { kind: "percentOfPosition", value: 100 }],
    ["sell all my solana", "sell", { kind: "percentOfPosition", value: 100 }],
  ];
  for (const [sentence, side, amount] of cases) {
    const spec = order(sentence);
    assert.equal(spec.entry?.side, side, sentence);
    assert.deepEqual(spec.entry?.amount, amount, sentence);
    assert.equal(spec.entry?.trigger, null, `${sentence} — must fill now`);
  }
});

test("a dollar amount sells as well as it buys", () => {
  // The regex read `\bbuy\b` for months. Half the order book was missing.
  assert.deepEqual(order("sell $200 of solana").entry?.amount, { kind: "usd", value: 200 });
  assert.deepEqual(order("buy $200 of solana").entry?.amount, { kind: "usd", value: 200 });
});

test("a share of the position is a share, not a token count", () => {
  /* percentOfPosition, resolved when the order RUNS. A stop could take half
     of it in between, and a token count read at arm time would try to sell
     coins that are no longer there. */
  const cases: [string, number][] = [
    ["sell half of my solana", 50],
    ["sell a third of my solana", 33],
    ["sell a quarter of my bonk", 25],
    ["sell 25% of my bonk", 25],
    ["sell the rest of my sol", 100],
    ["close my sol", 100],
    ["dump all my bonk", 100],
  ];
  for (const [sentence, value] of cases) {
    assert.deepEqual(
      order(sentence).entry?.amount,
      { kind: "percentOfPosition", value },
      sentence,
    );
  }
});

test("a limit order keeps its price", () => {
  assert.deepEqual(order("buy $500 of solana at $95").entry?.trigger, {
    kind: "priceAbsolute",
    value: 95,
  });
  assert.deepEqual(order("sell half of my solana at $120").entry?.trigger, {
    kind: "priceAbsolute",
    value: 120,
  });
});

/* ──────────────────────── the one that used to trade ────────────────────── */

test("a stated condition with no price NEVER becomes a market order", () => {
  /*
   * THE DANGEROUS ONE. "Buy $500 of SOL when it dips" parsed cleanly and came
   * out with `trigger: null`, which means fill immediately at whatever the
   * price is — the exact opposite of what the sentence asks for. Nothing was
   * refused and nothing was flagged. It simply bought.
   */
  for (const s of [
    "buy $500 of solana when it dips",
    "buy $500 of solana if it drops",
    "buy $500 of solana once it falls",
    "put a limit buy on solana for $500",
  ]) {
    const q = question(s);
    assert.match(q.question, /price/i, s);
    assert.ok(q.fill, `${s} — must offer somewhere to type the price`);
    assert.equal(q.fill?.expects, "price");
  }
});

test("a market order is not mistaken for an incomplete limit order", () => {
  // "at the current price" and "the rest" both contain words that look like
  // conditions and are not. Asking here would be as wrong as filling above.
  for (const s of [
    "buy me $500 of solana at the current price",
    "sell $200 of solana at the current market price",
    "sell the rest of my sol",
  ]) {
    assert.equal(kind(s), "order", s);
  }
});

/* ────────────────────────────── it asks ─────────────────────────────────── */

test("an order with no size asks how much, and offers the position for a sell", () => {
  const buy = question("buy solana at $95");
  assert.match(buy.question, /how much/i);
  assert.equal(buy.fill?.expects, "size");
  /* The price already given is carried into the template — answering "how
     much" must not quietly throw away the condition. */
  assert.match(buy.fill!.template, /95/);

  const sell = question("sell solana");
  assert.ok(
    sell.options.some((o) => /all/i.test(o.label)),
    "a sell should offer the whole position",
  );
});

test("a stop with no level asks where, and a trail asks how far", () => {
  const stop = question("stop me out of solana");
  assert.match(stop.question, /stop/i);
  assert.equal(stop.fill?.expects, "percent");

  const trail = question("trail my solana");
  assert.match(trail.question, /high/i);
  assert.equal(trail.fill?.expects, "percent");
});

test("the token in a question is a token, never a stray word", () => {
  /* "put a limit buy on solana for $500" built the template "buy $500 of PUT
     at {}" — the verb became the coin, and cipher asked a question about an
     asset that does not exist. */
  const q = question("put a limit buy on solana for $500");
  assert.match(q.fill!.template, /solana/);
  assert.doesNotMatch(q.fill!.template, /\bput\b/);

  const s = question("set a stop loss on solana");
  assert.match(s.question, /solana/);
  assert.doesNotMatch(s.question, /\bset\b/);
});

test("every question it asks can actually be answered", () => {
  // A clarify with no options and no fill is a dead end: a question on screen
  // with no buttons and no input, and no way out but retyping the sentence.
  for (const s of [
    "buy solana at $95",
    "sell solana",
    "buy $500 of solana when it dips",
    "stop me out of solana",
    "trail my solana",
  ]) {
    const q = question(s);
    assert.ok(q.fill != null || q.options.length >= 2, `${s} — unanswerable`);
    if (q.fill) assert.ok(q.fill.template.includes("{}"), `${s} — template has no hole`);
  }
});

/* ───────────────────────────── the round trip ───────────────────────────── */

test("answering a question produces the order it was asking about", () => {
  /*
   * The whole contract. The answer is substituted into the template and the
   * COMPLETED SENTENCE is compiled from scratch — same grammar, same
   * validation, same readback as anything typed by hand. Nothing anywhere
   * patches a half-built spec with a value.
   */
  const cases: [sentence: string, answer: string, check: (s: string) => void][] = [
    [
      "buy solana at $95",
      "$500",
      (filled) => {
        const spec = order(filled);
        assert.deepEqual(spec.entry?.amount, { kind: "usd", value: 500 });
        assert.deepEqual(spec.entry?.trigger, { kind: "priceAbsolute", value: 95 });
      },
    ],
    [
      "buy $500 of solana when it dips",
      "$95",
      (filled) => {
        const spec = order(filled);
        assert.deepEqual(spec.entry?.trigger, { kind: "priceAbsolute", value: 95 });
      },
    ],
    [
      "stop me out of solana",
      "-20%",
      (filled) => {
        const spec = order(filled);
        assert.deepEqual(spec.exits[0]?.trigger, { kind: "drawdownFromEntry", percent: 20 });
      },
    ],
    [
      "trail my solana",
      "30%",
      (filled) => {
        const spec = order(filled);
        assert.deepEqual(spec.exits[0]?.trigger, { kind: "trailingStop", percent: 30 });
      },
    ],
  ];

  for (const [sentence, answer, check] of cases) {
    const q = question(sentence);
    check(q.fill!.template.replace("{}", answer));
  }
});

test("every offered button is a sentence that compiles", () => {
  /*
   * A button that produces a refusal is worse than no button — the user picks
   * the answer cipher itself suggested and is told it was not understood. The
   * sell shortcuts were exactly this: "sell half of my solana" had no branch
   * in the grammar at all when the option was written.
   */
  for (const s of ["sell solana", "stop me out of solana", "trail my solana"]) {
    for (const opt of question(s).options) {
      assert.equal(
        kind(opt.sentence),
        "order",
        `"${opt.label}" on "${s}" produced "${opt.sentence}", which does not compile`,
      );
    }
  }
});

test("a question chains when more than one thing is missing", () => {
  // "How much" first, because the size decides whether there is an order at
  // all; the price falls out of the answer's own recompile.
  const first = question("buy solana when it dips");
  assert.equal(first.fill?.expects, "size");
  const second = compile(first.fill!.template.replace("{}", "$500"), ctx).intent;
  assert.equal(second.kind, "clarify");
  if (second.kind === "clarify") assert.equal(second.fill?.expects, "price");
});

/* ──────────────────────── it does not over-reach ────────────────────────── */

test("sentences that are not orders are left alone", () => {
  /* `askForMissing` recognises orders by their verbs, and "close" shuts a
     panel in one vocabulary and a position in another. It runs last for this
     reason; these prove the ordering holds. */
  assert.equal(kind("what's my p&l"), "query");
  assert.equal(kind("show me btc"), "navigate");
  assert.equal(kind("which token is up the most"), "screen");
  assert.equal(kind("what's armed"), "rules");
});

test("an opinion is still refused, not turned into a question", () => {
  // "Should I buy SOL?" contains "buy SOL". Refusing an opinion is the safest
  // thing to get wrong; asking "how much?" would be agreeing to place it.
  const i = compile("should i buy solana", ctx).intent;
  assert.equal(i.kind, "refusal");
  if (i.kind === "refusal") assert.equal(i.reason, "outOfScope");
});

test("two words never liquidate a position", () => {
  // "sell solana" was briefly a 100% market sell — no number, no question.
  assert.equal(kind("sell solana"), "clarify");
});

test("a token whose name is a condition word is still tradeable", () => {
  /*
   * Reported live, 23 Sep 2026. `pumps?` in the CONDITION pattern matched the
   * TICKER, so "buy $500 of PUMP" read as a sentence stating a condition with
   * no price: "What price should the buy trigger at?". Every order on a $3.7B
   * token was unplaceable.
   *
   * And it was two bugs, not one. The question offers "Actually, fill it now",
   * whose sentence still contains the word PUMP — so answering it asked the
   * same question again and the button looked broken.
   *
   * DIP, DROP, HIT, BREAK, RISE and LIMIT are all names somebody has minted.
   */
  const ctx = { symbol: "PUMP", label: "PUMP", interval: "1h" as const, hasPosition: false };
  assert.equal(compile("buy $500 of pump", ctx).intent.kind, "order");
  assert.equal(compile("buy $500 of pump at market price", ctx).intent.kind, "order");
  // The sentence the "Actually, fill it now" button sends.
  assert.equal(compile("buy $500 of pump at the current price", ctx).intent.kind, "order");
});

test("masking the ticker does not deafen the real condition words", () => {
  const ctx = { symbol: "PUMP", label: "PUMP", interval: "1h" as const, hasPosition: false };
  // "when" still says wait, even though "pumps" was masked out of the sentence.
  assert.equal(compile("buy $500 of pump when it pumps", ctx).intent.kind, "clarify");
  const resting = compile("buy $500 of pump when it drops to 0.0040", ctx).intent;
  assert.equal(resting.kind, "order");
  if (resting.kind === "order") {
    assert.deepEqual(resting.spec.entry?.trigger, { kind: "priceAbsolute", value: 0.004 });
  }
});
