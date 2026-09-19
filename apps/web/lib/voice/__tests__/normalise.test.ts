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
