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
  /* "The rest" is what the third leaves, not the whole position again. */
  assert.deepEqual(s.exits[1].amount, { kind: "percentOfPosition", value: 67 });
});

test("the rest is the remainder of every other exit, and all of it alone", () => {
  const ladder = parseWithGrammar("sell 30% at 2x, stop the rest at -50%")!;
  assert.deepEqual(ladder.exits[1].amount, { kind: "percentOfPosition", value: 70 });

  const alone = parseWithGrammar("sell the rest of my sol")!;
  assert.deepEqual(alone.entry!.amount, { kind: "percentOfPosition", value: 100 });
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

test("a bare number after 'at' on a sized exit is a price, and only a price", () => {
  // This once required "$", on the theory that "sell half at 200" could be a
  // percent or a multiple. It cannot: "200%" and "2x" carry their own marks
  // and are excluded. Requiring "$" only dropped real orders — found live,
  // 19 Sep 2026, "sell 30% at 100" lost without a word. A price wildly off
  // the market is caught by validate.ts instead.
  assert.deepEqual(parseWithGrammar("sell half at 200")!.exits[0].trigger, {
    kind: "priceAbsolute",
    value: 200,
  });
  assert.equal(
    parseWithGrammar("sell half at 2x")!.exits[0].trigger.kind,
    "priceMultiple",
  );
});

/* ─────────── the user's own cases, 19 Sep 2026 — verbatim shapes ────────── */

test("an exit's price never becomes the entry's limit", () => {
  // Case I. The $95 belongs to the stop; the buy is at market.
  const s = parseWithGrammar("buy 5 sol, sell 30% at $95, sell 100% at $135")!;
  assert.equal(s.entry!.trigger, null);
  assert.deepEqual(
    s.exits.map((x) => [x.trigger, x.amount]),
    [
      [{ kind: "priceAbsolute", value: 95 }, { kind: "percentOfPosition", value: 30 }],
      [{ kind: "priceAbsolute", value: 135 }, { kind: "percentOfPosition", value: 100 }],
    ],
  );
});

test("a stop loss and a target price, said as plain numbers, both arm", () => {
  // Case II. Both used to be dropped without a word.
  const s = parseWithGrammar(
    "buy 5 sol when sol drops to 90, once bought set a stop loss to 80 and a target price to 100",
  )!;
  assert.deepEqual(s.entry!.trigger, { kind: "priceAbsolute", value: 90 });
  assert.deepEqual(
    s.exits.map((x) => x.trigger),
    [
      { kind: "priceAbsolute", value: 80 },
      { kind: "priceAbsolute", value: 100 },
    ],
  );
});

test("a trailing stop is still one exit, not a stop as well", () => {
  assert.equal(parseWithGrammar("trailing stop at 10%")!.exits.length, 1);
});

test("the second rung of a sell needs no verb of its own", () => {
  // Found live, 19 Sep 2026: "and rest of 70% at $95" was dropped silently.
  for (const s of [
    "buy me $100 of solana and sell 30% at $100 and rest of 70% at $95",
    "buy $100 of sol, sell 30% at $100 and 70% at $95",
    "buy $100 of sol, sell 30% at $100 and the rest at $95",
  ]) {
    const spec = parseWithGrammar(s)!;
    assert.deepEqual(
      spec.exits.map((x) => [x.trigger, x.amount]),
      [
        [{ kind: "priceAbsolute", value: 100 }, { kind: "percentOfPosition", value: 30 }],
        [{ kind: "priceAbsolute", value: 95 }, { kind: "percentOfPosition", value: 70 }],
      ],
      s,
    );
  }
});

test("a stop after a sell rung is still a stop, not a rung", () => {
  const spec = parseWithGrammar("buy $100 of sol, sell 30% at $120 and stop at $80")!;
  assert.equal(spec.exits.length, 2);
});

test("a target at a bare price is read, not silently dropped", () => {
  /*
   * Found by the corpus, 23 Sep 2026: 486 of 5,085 rows. "sell at 300" needed
   * a "$" that "stop at 180" and "target 300" — the two rules directly below
   * it in grammar.ts — have never needed. So the buy armed, the target did
   * not, and nothing on screen said half the sentence had been discarded.
   */
  const target = (text: string) =>
    parseWithGrammar(text)?.exits.map((e) => e.trigger);

  assert.deepEqual(target("buy $500 of sol and sell at 300"), [
    { kind: "priceAbsolute", value: 300 },
  ]);
  assert.deepEqual(target("buy $500 of sol and take profit at 300"), [
    { kind: "priceAbsolute", value: 300 },
  ]);
  // The multiple form still wins where it applies — "2x" is not the price 2.
  assert.deepEqual(target("buy $500 of sol and take profit at 2x"), [
    { kind: "priceMultiple", value: 2 },
  ]);
  // And a percentage after "at" is still not a price.
  assert.deepEqual(target("buy $500 of sol and stop at -10%"), [
    { kind: "drawdownFromEntry", percent: 10 },
  ]);
});

test('"sell 70% of it at X" is an exit; "sell 70% of my SOL at X" is a resting sell', () => {
  /*
   * Reported live, 23 Sep 2026: "buy $100 of ZDC at 1500 and sell 70% of it
   * at 1300" built the buy and dropped the exit, because the price had to
   * follow the size immediately and "of it" sat between them.
   *
   * The pronoun restriction is load-bearing, not tidiness. "of it" refers
   * back to the buy in the same sentence. "of my SOL" names a holding, which
   * the entry branch builds as a sell with a trigger — and accepting both
   * here armed BOTH, selling the same 50% twice.
   */
  const compound = parseWithGrammar("buy $100 of zdc at 1500 and sell 70% of it at 1300");
  assert.deepEqual(compound?.entry?.trigger, { kind: "priceAbsolute", value: 1500 });
  assert.deepEqual(compound?.exits.map((e) => [e.trigger, e.amount]), [
    [{ kind: "priceAbsolute", value: 1300 }, { kind: "percentOfPosition", value: 70 }],
  ]);

  const resting = parseWithGrammar("sell half of my sol at 300");
  assert.equal(resting?.entry?.side, "sell");
  assert.deepEqual(resting?.entry?.trigger, { kind: "priceAbsolute", value: 300 });
  assert.deepEqual(resting?.exits, [], "a resting sell must not also arm a duplicate exit");
});

test('"the rest" counts what a resting sell already claimed', () => {
  /*
   * "sell 70% of my PUMP at 0.0042 and the rest at 0.0048" puts the 70% in the
   * ENTRY, because a resting sell is an entry with a trigger. The exits were
   * therefore empty when "the rest" was resolved, and it came back 100% — so
   * the ladder sold 70% and then the lot. Reported live, 23 Sep 2026.
   */
  const spec = parseWithGrammar("sell 70% of my pump at 0.0042 and the rest at 0.0048")!;
  assert.deepEqual(spec.entry?.amount, { kind: "percentOfPosition", value: 70 });
  assert.deepEqual(spec.exits.map((e) => e.amount), [
    { kind: "percentOfPosition", value: 30 },
  ]);
});

test("a token count is read after every opening verb, not just buy and sell", () => {
  /*
   * The dollar branch took buy|sell|ape|grab|cop|get me|dump; this one took
   * buy|sell. So "grab 5 tokens of btc and sell at 150000" kept the exit and
   * dropped the buy — arming a sell against a position nobody had opened —
   * and compile.ts' half-read guard could not see it, because that looks for
   * a "$" amount the parse did not use and "5 tokens" has none.
   *
   * One list, written three times, and two copies went stale. Found by the
   * corpus, 23 Sep 2026: it was the whole of the remaining 7.3%.
   */
  for (const verb of ["buy", "grab", "get me", "ape", "put"]) {
    const spec = parseWithGrammar(`${verb} 5 tokens of btc and sell at 150000`);
    assert.deepEqual(
      spec?.entry?.amount,
      { kind: "tokens", value: 5 },
      `"${verb}" must open a token-denominated position`,
    );
    assert.equal(spec?.entry?.side, "buy");
    assert.equal(spec?.exits.length, 1);
  }
  assert.equal(parseWithGrammar("dump 5 tokens of btc")?.entry?.side, "sell");
});

test('"put" reads the entry clause, not the exit clause behind it', () => {
  /*
   * entryClause() holds a THIRD copy of the verb list, and a verb missing
   * from it is the worst of the three: `search` finds the first verb it does
   * know, which is the exit's. "put $500 into sol and sell at 300" skipped to
   * "sell at 300", read that as the entry clause, and armed a resting buy at
   * the take-profit price — so the order rested at 300 instead of filling
   * now, and 300 was also its target.
   */
  const spec = parseWithGrammar("put $500 into sol and sell at 300")!;
  assert.equal(spec.entry?.trigger, null, "a market buy must not inherit the target's price");
  assert.deepEqual(spec.exits.map((e) => e.trigger), [{ kind: "priceAbsolute", value: 300 }]);
  // And a real resting entry still rests.
  assert.deepEqual(parseWithGrammar("put $500 into sol when it drops to 190")?.entry?.trigger, {
    kind: "priceAbsolute",
    value: 190,
  });
});

test("a connective is never mistaken for a token", () => {
  /* "put ten bucks in and cut me if it drops ten percent" names no token, and
     `in` is an optional preposition — so the capture took "and", then "in",
     and armed a $10 buy of a coin by that name. No entry is the right answer:
     compile.ts then sees an unused dollar figure and hands the whole sentence
     to the model instead of answering with half an order. */
  assert.equal(parseWithGrammar("buy $10 in and cut me if it drops 10%")?.entry, null);
  assert.equal(parseWithGrammar("put $10 in and stop at 5%")?.entry, null);
});

test("a spoken order without commas keeps its clauses apart", () => {
  /*
   * From the microphone, 24 Sep 2026:
   *
   *   "buy me $5 of pump set a stop loss at 0.0038 and sell it all at 0.0042"
   *
   * entryClause split only on written punctuation — commas, "and", "then" —
   * and speech has none of it. The first "and" sits in front of "sell", so the
   * entry clause ran through the stop and the BUY took 0.0038 as its own limit
   * price: a market buy became a resting order at the stop level, the stop
   * armed at the same price, and the target disappeared. Three errors from one
   * missing comma.
   *
   * "sell IT all" was the second half of it — nothing in the exit pattern
   * could consume "it" before the size, so the 0.0042 target never matched.
   */
  const spec = parseWithGrammar(
    "buy me $5 of pump set a stop loss at 0.0038 and sell it all at 0.0042",
  )!;
  assert.deepEqual(spec.entry?.amount, { kind: "usd", value: 5 });
  assert.equal(spec.entry?.trigger, null, "a market buy must not take the stop's price");
  assert.deepEqual(
    spec.exits.map((e) => e.trigger).sort((a, b) => (a as never as { value: number }).value - (b as never as { value: number }).value),
    [
      { kind: "priceAbsolute", value: 0.0038 },
      { kind: "priceAbsolute", value: 0.0042 },
    ],
  );
});

test("a written resting entry still rests", () => {
  /* The clause split must not cost the case it was protecting. */
  const spec = parseWithGrammar("buy $500 of sol at 95 and stop at 90")!;
  assert.deepEqual(spec.entry?.trigger, { kind: "priceAbsolute", value: 95 });
  assert.deepEqual(spec.exits.map((e) => e.trigger), [{ kind: "priceAbsolute", value: 90 }]);
});

test("a target percentage is the mirror of a stop percentage", () => {
  /*
   * Reported live, 24 Sep 2026: "$100 of cash stop at 10% target at 30%"
   * placed the stop, could not place the 30%, and refused the whole order
   * over the half it understood. A stop percentage is how far DOWN from the
   * entry you will go and a target percentage is how far UP; reading one and
   * not the other is arbitrary.
   *
   * It is a MULTIPLE, not a seventh member of the Trigger union: +30% from
   * the fill is 1.3x from the fill, exactly, and priceMultiple already binds
   * to the entry price the way drawdownFromEntry does.
   */
  const spec = parseWithGrammar("buy $500 of sol, stop at 20% and target at 50%")!;
  assert.deepEqual(spec.exits.map((e) => e.trigger), [
    { kind: "drawdownFromEntry", percent: 20 },
    { kind: "priceMultiple", value: 1.5 },
  ]);
  assert.deepEqual(parseWithGrammar("buy $100 of sol and take profit at 25%")?.exits[0]?.trigger, {
    kind: "priceMultiple",
    value: 1.25,
  });
  // A price target and a multiple target are untouched by the new rule.
  assert.deepEqual(parseWithGrammar("buy $500 of sol and target 130")?.exits[0]?.trigger, {
    kind: "priceAbsolute",
    value: 130,
  });
  assert.deepEqual(parseWithGrammar("buy $500 of sol and take profit at 2x")?.exits[0]?.trigger, {
    kind: "priceMultiple",
    value: 2,
  });
});
