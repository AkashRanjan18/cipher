import { test } from "node:test";
import assert from "node:assert/strict";
import { compile } from "../compile.ts";
import { readback } from "../readback.ts";
import { normaliseSpeech } from "../../voice/normalise.ts";
import type { CompileContext, OrderSpec } from "@cipher/shared";

/**
 * The five execution knobs, the ladder, and the guard that catches the rest.
 *
 * These are differentiator #1 in CLAUDE.md — *"slippage tolerance, priority
 * fee, MEV/private submission, tip sizing, position sizing"* — the settings
 * Photon and BullX expose and most people set wrong, and that fomo does not
 * expose at all. Two of the five were being silently discarded: the sentence
 * asked for a high priority fee, the order armed at ordinary speed, and the
 * readback said nothing. The feature the product is built around was
 * three-fifths wired and failing quietly on the rest.
 */

const ctx: CompileContext = {
  symbol: "So11111111111111111111111111111111111111112",
  interval: "1h",
  hasPosition: true,
};

function spec(s: string): OrderSpec {
  const i = compile(s, ctx).intent;
  assert.equal(i.kind, "order", `"${s}" should be an order, got ${i.kind}`);
  if (i.kind !== "order") throw new Error("unreachable");
  return i.spec;
}

const warnings = (s: string) => compile(s, ctx).warnings;
const kind = (s: string) => compile(s, ctx).intent.kind;

/* ──────────────────────────── the five knobs ────────────────────────────── */

test("all five execution knobs reach the spec", () => {
  const e = spec(
    "buy $500 of bonk with 1% slippage, high priority, a 0.002 sol tip, public mempool",
  ).entry;
  assert.deepEqual(e?.amount, { kind: "usd", value: 500 }); // position sizing
  assert.equal(e?.slippageBps, 100);
  assert.equal(e?.priority, "high");
  assert.equal(e?.tipSol, 0.002);
  assert.equal(e?.privateSubmission, false);
});

test("each knob works on its own", () => {
  assert.equal(spec("buy $500 of bonk with 1% slippage").entry?.slippageBps, 100);
  assert.equal(spec("buy $500 of bonk with a high priority fee").entry?.priority, "high");
  assert.equal(spec("buy $500 of bonk turbo").entry?.priority, "turbo");
  assert.equal(spec("buy $500 of bonk with a 0.001 sol tip").entry?.tipSol, 0.001);
  assert.equal(spec("buy $500 of bonk, tip 0.002").entry?.tipSol, 0.002);
  assert.equal(
    spec("buy $500 of bonk through the public mempool").entry?.privateSubmission,
    false,
  );
});

test("unstated knobs keep their defaults, and private is the default", () => {
  const e = spec("buy $500 of bonk").entry;
  assert.equal(e?.slippageBps, 300);
  assert.equal(e?.priority, "normal");
  assert.equal(e?.tipSol, null);
  // The user did not ask to be sandwiched.
  assert.equal(e?.privateSubmission, true);
});

test("an absurd tip is refused rather than armed", () => {
  // "tip 5" is five SOL to a builder on a $20 trade. A fat finger, not a bid.
  assert.equal(spec("buy $500 of bonk, tip 5").entry?.tipSol, null);
});

test("the knobs that cost money appear on the readback", () => {
  const lines = readback(spec("buy $500 of bonk turbo with a 0.002 sol tip"));
  assert.ok(lines.some((l) => l.label === "PRIORITY"), "priority must be shown");
  assert.ok(lines.some((l) => l.label === "TIP"), "tip must be shown");
  // Silent at their defaults — a line nobody can meaningfully approve is noise.
  const plain = readback(spec("buy $500 of bonk"));
  assert.ok(!plain.some((l) => l.label === "PRIORITY" || l.label === "TIP"));
});

/* ────────────────────────────── the ladder ──────────────────────────────── */

test("a ladder keeps every rung, not just the one with the verb", () => {
  /* "sell 25% at 2x and 25% at 5x" is one sentence with two rungs and only the
     first carries "sell" — nobody repeats the verb. The 5x was armed nowhere
     and mentioned nowhere. */
  const exits = spec("sell 25% at 2x and 25% at 5x").exits;
  assert.equal(exits.length, 2);
  assert.deepEqual(
    exits.map((e) => e.trigger),
    [{ kind: "priceMultiple", value: 2 }, { kind: "priceMultiple", value: 5 }],
  );
});

test("the canonical compound sentence still compiles exactly", () => {
  const s = spec("buy $500 of bonk, sell a third at 2x, stop the rest at -50%");
  assert.deepEqual(s.entry?.amount, { kind: "usd", value: 500 });
  assert.equal(s.exits.length, 2);
  assert.deepEqual(s.exits[0].trigger, { kind: "priceMultiple", value: 2 });
  assert.deepEqual(s.exits[1].trigger, { kind: "drawdownFromEntry", percent: 50 });
});

/* ─────────────────────────────── the guard ──────────────────────────────── */

test("a knob that was asked for and not honoured is said out loud", () => {
  /*
   * The rule is already written in grammar.ts: "Swallowing an instruction is
   * the one thing neither of them is allowed to do." Nothing enforced it.
   * This is the enforcement, and it catches the cases nobody has thought of
   * because it compares the SENTENCE against the SPEC rather than the parser
   * against itself.
   */
  assert.ok(warnings("buy $500 of bonk with a tip").some((w) => /tip/i.test(w)));
  assert.ok(warnings("buy $500 of bonk and stop it").some((w) => /stop/i.test(w)));
  assert.ok(
    warnings("buy $500 of bonk with a trailing stop").some((w) => /trailing/i.test(w)),
  );
});

test("the guard stays quiet when the knob DID take", () => {
  // A warning on a sentence that worked is worse than no warning at all — it
  // teaches the user to skim past the ones that matter.
  assert.deepEqual(warnings("buy $500 of bonk with 1% slippage"), []);
  assert.deepEqual(warnings("buy $500 of bonk with a high priority fee"), []);
  assert.deepEqual(warnings("buy $500 of bonk with a 0.001 sol tip"), []);
  assert.deepEqual(warnings("buy $500 of bonk, sell a third at 2x, stop the rest at -50%"), []);
});

test("a trailing stop warns once, not twice", () => {
  // "A trailing stop" is one instruction. Both checks match it and only the
  // specific message helps.
  const w = warnings("buy $500 of bonk with a trailing stop");
  assert.equal(w.filter((x) => /stop/i.test(x)).length, 1);
});

/* ──────────────────────── perps refuse honestly ─────────────────────────── */

test("leverage never becomes a spot order", () => {
  /*
   * "go long sol 3x" asked how much SOL to BUY, and "close my short" sold a
   * hundred percent of a position in a token called "short". Same direction,
   * wrong instrument, and no liquidation price anywhere on the card.
   */
  for (const s of [
    "short sol with 5x leverage",
    "go long sol 3x",
    "close my short",
    "what's my liquidation price",
    "switch to isolated margin",
  ]) {
    const i = compile(s, ctx).intent;
    assert.equal(i.kind, "refusal", s);
    if (i.kind === "refusal") {
      /* `notBuilt`, not `notUnderstood`. The difference is whether the user
         retypes the sentence four times or learns that perps are phase 3. */
      assert.equal(i.reason, "notBuilt", s);
    }
  }
});

/* ────────────────────── "by" is a preposition ───────────────────────────── */

test("a spoken order still starts with buy", () => {
  assert.match(normaliseSpeech("by five hundred dollars of soul"), /^buy \$500 of sol/);
  assert.match(normaliseSpeech("and by $200 of bonk"), /and buy \$200/);
});

test("a typed \"by\" in the middle of a sentence stays \"by\"", () => {
  /*
   * The homophone table rewrote EVERY "by" to "buy", on a note claiming it was
   * safe because "by never begins an order" — a positional argument the code
   * did not implement. It runs on typed text too, so "trail my sol by 40%"
   * became "trail my sol buy 40%" and stopped parsing, for a sentence nobody
   * dictated.
   */
  assert.equal(normaliseSpeech("trail my sol by 40%"), "trail my sol by 40%");
  assert.deepEqual(spec("trail my sol by 40%").exits[0].trigger, {
    kind: "trailingStop",
    percent: 40,
  });
});

/* ─────────────────────────── the plainer verbs ──────────────────────────── */

test("the verbs people actually use", () => {
  assert.deepEqual(spec("ape $200 into bonk").entry?.amount, { kind: "usd", value: 200 });
  assert.equal(spec("ape $200 into bonk").entry?.side, "buy");
  assert.deepEqual(spec("get me $100 of wif").entry?.amount, { kind: "usd", value: 100 });
  assert.equal(spec("dump $300 of bonk").entry?.side, "sell");
});

test("stops phrased the way people say them", () => {
  for (const [s, percent] of [
    ["stop my sol at -30%", 30],
    ["cut my losses at -15%", 15],
    ["stop me out if it drops 25%", 25],
    ["trail my sol by 40%", 40],
  ] as const) {
    const e = spec(s).exits[0];
    assert.ok(e, s);
    assert.equal(
      e.trigger.kind === "drawdownFromEntry" || e.trigger.kind === "trailingStop"
        ? (e.trigger as { percent: number }).percent
        : null,
      percent,
      s,
    );
  }
});

test("a resting price does not have to use the word \"at\"", () => {
  // "below", "under", "hits", "reaches" — "sell everything if SOL goes below
  // 80" asked what price to trigger at, having just been told.
  for (const [s, value] of [
    ["buy $500 of sol when it hits 95", 95],
    ["buy $500 of sol if it drops to 90", 90],
    ["sell my sol when it reaches 150", 150],
  ] as const) {
    assert.deepEqual(spec(s).entry?.trigger, { kind: "priceAbsolute", value }, s);
  }
});

test("a multiple is still a multiple, not a price in dollars", () => {
  // The widened price vocabulary must not eat "at 2x" or "at 50%".
  assert.equal(spec("buy $500 of bonk, sell half at 2x").entry?.trigger, null);
  assert.equal(kind("stop at -20%"), "order");
});

test("the size and the token can sit at opposite ends of the sentence", () => {
  /* "Sell everything if SOL goes below 80" names the size first and the token
     six words later. Every pattern expected them adjacent, so cipher asked
     what price to trigger at while the number sat at the end of the sentence
     it had just read. */
  const e = spec("sell everything if sol goes below 80").entry;
  assert.equal(e?.token, "sol");
  assert.deepEqual(e?.amount, { kind: "percentOfPosition", value: 100 });
  assert.deepEqual(e?.trigger, { kind: "priceAbsolute", value: 80 });
});

test("an opinion is refused as out of scope, never as a misunderstanding", () => {
  /* The reason is the message. "I didn't get that" invites a rephrase of a
     question cipher will never answer however it is put. */
  for (const s of [
    "should i buy sol",
    "is sol going to pump",
    "what do you think of bonk",
    "send $500 to my friend",
  ]) {
    const i = compile(s, ctx).intent;
    assert.equal(i.kind, "refusal", s);
    if (i.kind === "refusal") assert.equal(i.reason, "outOfScope", s);
  }
});
