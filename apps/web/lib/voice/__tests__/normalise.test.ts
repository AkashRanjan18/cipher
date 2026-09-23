import { test } from "node:test";
import assert from "node:assert/strict";
import { normaliseSpeech } from "../normalise.ts";
import { parseWithGrammar } from "../../compiler/grammar.ts";

/**
 * The tests that matter are the end-to-end ones: a sentence as a recogniser
 * would actually transcribe it, all the way through the compiler to a spec.
 * Checking the normaliser's output string alone would let it drift into
 * producing something tidy that the grammar still cannot read.
 */

test("the canonical sentence survives being spoken", () => {
  // What Chrome actually returns for the sentence in CLAUDE.md.
  const heard = "by five hundred dollars of soul, sell a third at two x, stop the rest at fifty percent";

  const spec = parseWithGrammar(normaliseSpeech(heard));
  assert.ok(spec, "the spoken form must compile");

  assert.equal(spec.entry?.side, "buy");
  assert.equal(spec.entry?.token, "sol");
  assert.deepEqual(spec.entry?.amount, { kind: "usd", value: 500 });

  assert.equal(spec.exits.length, 2);
  assert.deepEqual(spec.exits[0].trigger, { kind: "priceMultiple", value: 2 });
  assert.deepEqual(spec.exits[0].amount, { kind: "percentOfPosition", value: 33 });
  assert.deepEqual(spec.exits[1].trigger, { kind: "drawdownFromEntry", percent: 50 });
});

test("the raw transcript would NOT have compiled", () => {
  /* The reason this file exists. Without normalisation the grammar returns
     null and Sana refuses — correct behaviour, but it reads as voice being
     broken rather than as the compiler protecting the user. */
  const heard = "by five hundred dollars of soul, sell a third at two x, stop the rest at fifty percent";
  assert.equal(parseWithGrammar(heard), null);
});

test("number words become digits, including compound ones", () => {
  const n = (s: string) => normaliseSpeech(s);
  assert.equal(n("five hundred"), "500");
  assert.equal(n("twelve hundred"), "1200");
  assert.equal(n("one thousand five hundred"), "1500");
  assert.equal(n("twenty five"), "25");
  assert.equal(n("two million"), "2000000");
  assert.equal(n("a hundred"), "100");
  assert.equal(n("two point five"), "2.5");
});

test("a spoken amount becomes a dollar amount", () => {
  assert.equal(normaliseSpeech("buy two thousand dollars of sol"), "buy $2000 of sol");
  assert.equal(normaliseSpeech("buy fifty bucks of sol"), "buy $50 of sol");
});

test("percent, multiples and signs get their symbols", () => {
  assert.equal(normaliseSpeech("fifty percent"), "50%");
  assert.equal(normaliseSpeech("at two x"), "at 2x");
  assert.equal(normaliseSpeech("at three times"), "at 3x");
  assert.equal(normaliseSpeech("sell half at double"), "sell half at 2x");
  assert.equal(normaliseSpeech("stop at minus forty percent"), "stop at -40%");
});

test("fractions the grammar already understands are left alone", () => {
  /* "a third" must survive intact — the leading "a" is only a number when a
     scale word follows it, or this rewrites the fraction into nonsense. */
  assert.equal(normaliseSpeech("sell a third at two x"), "sell a third at 2x");
  assert.equal(normaliseSpeech("sell a half at two x"), "sell a half at 2x");
  assert.equal(normaliseSpeech("stop the rest at fifty percent"), "stop the rest at 50%");
});

test("filler words are dropped without touching the order", () => {
  const spec = parseWithGrammar(
    normaliseSpeech("um okay please buy one hundred dollars of sol"),
  );
  assert.deepEqual(spec?.entry?.amount, { kind: "usd", value: 100 });
});

test("a slippage instruction survives", () => {
  const spec = parseWithGrammar(
    normaliseSpeech("buy five hundred dollars of sol max three percent slippage"),
  );
  assert.equal(spec?.entry?.slippageBps, 300);
});

test("it refuses rather than inventing what was not said", () => {
  /* Half a sentence must stay half a sentence. The normaliser is a
     stenographer, not a second parser — if it filled in a plausible amount
     here the readback would look right and be wrong. */
  assert.equal(parseWithGrammar(normaliseSpeech("buy me some sol")), null);
  assert.equal(parseWithGrammar(normaliseSpeech("what is sol doing")), null);
  assert.equal(parseWithGrammar(normaliseSpeech("")), null);
});

test("already-written input passes through unharmed", () => {
  const typed = "buy $500 of sol, sell a third at 2x and stop the rest at -50%";
  const a = parseWithGrammar(typed)!;
  const b = parseWithGrammar(normaliseSpeech(typed))!;

  assert.deepEqual(b.entry, a.entry);
  assert.equal(b.exits.length, a.exits.length);
  assert.deepEqual(
    b.exits.map((e) => e.trigger),
    a.exits.map((e) => e.trigger),
  );
});

test("typed shorthand nobody thinks twice about now works", () => {
  // The grammar wants a "$"; a person typing quickly does not supply one.
  assert.equal(parseWithGrammar("buy 500 dollars of sol"), null);
  const spec = parseWithGrammar(normaliseSpeech("buy 500 dollars of sol"));
  assert.deepEqual(spec?.entry?.amount, { kind: "usd", value: 500 });
});

test("prices said the spoken way: one twenty is 120, twenty one is 21", () => {
  assert.equal(normaliseSpeech("target one twenty dollars"), "target $120");
  assert.equal(normaliseSpeech("target two fifty"), "target 250");
  assert.equal(normaliseSpeech("target one twenty five dollars"), "target $125");
  assert.equal(normaliseSpeech("buy twenty one dollars of sol"), "buy $21 of sol");
});

test("thousands written with k become digits", () => {
  // Found live: "81.5k" was read as $81.
  assert.equal(normaliseSpeech("buy 0.001 tokens of btc when it reaches 81.5k"), "buy 0.001 tokens of btc when it reaches 81500");
  assert.equal(normaliseSpeech("buy $1.5k of sol"), "buy $1500 of sol");
});

test("a memecoin price said out loud keeps its leading zeros", () => {
  /*
   * Found by the user, 23 Sep 2026. A run that BEGAN at "point" scored
   * `seen === false`, so the whole run failed, "point" survived as a word and
   * the digits behind it were rescanned on their own: "point zero zero four"
   * came back "point 4". That is a stop at four dollars instead of four
   * thousandths of one — three orders of magnitude, silently, on the price
   * range cipher actually trades.
   */
  assert.equal(normaliseSpeech("sell at point zero zero four"), "sell at 0.004");
  assert.equal(normaliseSpeech("sell at zero point zero zero four"), "sell at 0.004");
  assert.equal(normaliseSpeech("stop at point five"), "stop at 0.5");
  assert.equal(normaliseSpeech("stop at zero point zero one"), "stop at 0.01");
});

test('"oh" is a zero beside a decimal point and an interjection everywhere else', () => {
  assert.equal(normaliseSpeech("sell at oh point oh oh four"), "sell at 0.004");
  assert.equal(normaliseSpeech("sell at point oh oh four two"), "sell at 0.0042");
  // The guard: a recogniser transcribes an interjection faithfully, and a 0
  // in front of an order is worse than a stray word in it.
  assert.equal(normaliseSpeech("oh buy some sol"), "oh buy some sol");
  assert.equal(normaliseSpeech("oh, sell half"), "oh, sell half");
});

test('a bare "point" is the English word, not zero', () => {
  // `seen` now counts the decimal branch, so this needs its own guard.
  assert.equal(normaliseSpeech("what's the point"), "what's the point");
  assert.equal(normaliseSpeech("point"), "point");
});
