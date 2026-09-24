import { MARKETS } from "../../market/markets.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { compile } from "../compile.ts";
import { choose } from "../choose.ts";
import type { CompileContext } from "@cipher/shared";

const CTX: CompileContext = { symbol: "SOLUSDT", interval: "1h", hasPosition: true };
const kind = (s: string) => compile(s, CTX).intent.kind;

/* ─────────────────────────── it always answers ─────────────────────────── */

test("every sentence produces an intent — the compiler never returns nothing", () => {
  for (const s of ["", "   ", "asdkjhasd", "buy", "🚀🚀🚀", "sell half at 2x"]) {
    const out = compile(s, CTX);
    assert.ok(out.intent.kind, JSON.stringify(s));
    assert.equal(out.version, 1);
  }
});

/* ──────────────────────────────── orders ───────────────────────────────── */

test("an order beats every looser matcher that also matches it", () => {
  // "sell half at 2x" mentions a size and an action; the query and screen
  // matchers both contain words that appear in it. Specific runs first.
  assert.equal(kind("sell half at 2x"), "order");
  assert.equal(kind("buy $500 of solana"), "order");
  assert.equal(kind("buy $500 of solana, sell half at 2x, stop the rest at -50%"), "order");
  assert.equal(kind("stop SOL at -20%"), "order");
  assert.equal(kind("trailing stop at 10%"), "order");
});

/* ─────────────────────── the one that must not trade ───────────────────── */

test('"should I buy SOL" is a refusal, not a buy', () => {
  const out = compile("should i buy sol right now", CTX);
  assert.equal(out.intent.kind, "refusal");
  assert.equal(out.intent.kind === "refusal" && out.intent.reason, "outOfScope");
  /*
   * This is the single most important ordering rule in the file. The sentence
   * contains "buy sol". Refusing an opinion is the safest thing to get wrong;
   * filling one is the worst.
   */
});

test("cipher says plainly what it will never do", () => {
  for (const s of ["what's the weather", "find me tokens on twitter", "will sol moon"]) {
    const out = compile(s, CTX);
    assert.equal(out.intent.kind, "refusal", s);
    assert.equal(out.intent.kind === "refusal" && out.intent.reason, "outOfScope", s);
  }
});

/* ─────────────────────────────── ambiguity ─────────────────────────────── */

test('"buy 500 solana" asks instead of guessing', () => {
  const out = compile("buy 500 solana", CTX);
  assert.equal(out.intent.kind, "clarify");
  if (out.intent.kind !== "clarify") return;
  assert.equal(out.intent.options.length, 2);
  // Each option is the SENTENCE rewritten, not a patch to a half-parsed spec:
  // picking one re-runs the whole compiler.
  assert.equal(compile(out.intent.options[0].sentence, CTX).intent.kind, "order");
  assert.equal(compile(out.intent.options[1].sentence, CTX).intent.kind, "order");
});

test("a unit marker settles it, and nothing is asked", () => {
  assert.equal(kind("buy $500 of solana"), "order");
  assert.equal(kind("buy 500 dollars of solana"), "order");
});

test("an unknown token is not an ambiguity", () => {
  // "buy 500 wagmi" is a different problem — there is no such market — and
  // asking "dollars or tokens?" about a token that does not exist is worse
  // than saying so.
  assert.notEqual(kind("buy 500 wagmi"), "clarify");
});

/* ──────────────────────────────── screen ───────────────────────────────── */

test("the whole family of 'what pumped' sentences lands on one intent", () => {
  for (const s of [
    "which token gave the most return today",
    "what's up the most",
    "show me the biggest gainer",
    "find me the best performer",
  ]) {
    const out = compile(s, CTX);
    assert.equal(out.intent.kind, "screen", s);
    assert.equal(out.intent.kind === "screen" && out.intent.direction, "top", s);
  }
});

test("losers are the same list read from the other end", () => {
  const out = compile("what's the worst performer", CTX);
  assert.equal(out.intent.kind, "screen");
  assert.equal(out.intent.kind === "screen" && out.intent.direction, "bottom");
});

test('"today" is answered with 24 hours, and says so', () => {
  const out = compile("which token gave the most return today", CTX);
  assert.equal(out.warnings.length, 1);
  assert.match(out.warnings[0], /24 hours/);
});

test("a screen about MY things is a query, not a screen", () => {
  // "what's my best trade" is about the account. The pronoun is the whole
  // difference, and getting it wrong answers a completely different question.
  assert.notEqual(kind("what is my p&l"), "screen");
});

test("top N is honoured and capped", () => {
  const five = compile("show me the top 5 gainers", CTX);
  assert.equal(five.intent.kind === "screen" && five.intent.limit, 5);
  const absurd = compile("show me the top 99 gainers", CTX);
  assert.equal(absurd.intent.kind === "screen" && absurd.intent.limit, 14);
});

/* ──────────────────────────────── queries ──────────────────────────────── */

test("questions about the account compile to query", () => {
  assert.equal(kind("what's my position"), "query");
  assert.equal(kind("how much cash do i have"), "query");
  assert.equal(kind("what is my pnl"), "query");
  assert.equal(kind("show me my fills"), "query");
  assert.equal(kind("what have i paid in fees"), "query");
});

/* ───────────────────────────────── rules ───────────────────────────────── */

test("the engine is addressable in words, now that it exists", () => {
  const list = compile("what rules are armed", CTX);
  assert.equal(list.intent.kind, "rules");
  assert.equal(list.intent.kind === "rules" && list.intent.action, "list");

  const clear = compile("cancel all my stops", CTX);
  assert.equal(clear.intent.kind, "rules");
  assert.equal(clear.intent.kind === "rules" && clear.intent.action, "cancelAll");
});

/* ──────────────────────────── navigate and ui ──────────────────────────── */

test("switching what the terminal is looking at", () => {
  /* The market key for BTC is its MINT now, not a Binance pair — majors are
     wrapped assets on Solana, so "show me btc" navigates to something the
     ticket can actually buy. Asserted against MARKETS rather than a literal,
     so the test follows the list instead of pinning an address by hand. */
  const btcMint = MARKETS.find((m) => m.base === "BTC")?.symbol;
  const btc = compile("show me btc", CTX);
  assert.equal(btc.intent.kind, "navigate");
  assert.equal(btc.intent.kind === "navigate" && btc.intent.symbol, btcMint);

  const daily = compile("switch to the daily chart", CTX);
  assert.equal(daily.intent.kind, "navigate");
  assert.equal(daily.intent.kind === "navigate" && daily.intent.interval, "1d");
});

test("an unknown market does not become a navigation to nowhere", () => {
  assert.notEqual(kind("show me wagmi"), "navigate");
});

test("the controls nobody ever finds", () => {
  assert.equal(kind("collapse the panel"), "ui");
  assert.equal(kind("split right"), "ui");
  assert.equal(kind("reset the chart"), "ui");
});

/* ────────────────────────────── the boundary ───────────────────────────── */

test("a sentence nobody can parse says what to try instead", () => {
  const out = compile("flurble the wizzbang", CTX);
  assert.equal(out.intent.kind, "refusal");
  assert.equal(out.intent.kind === "refusal" && out.intent.reason, "notUnderstood");
  // A refusal that does not teach the boundary teaches nothing.
  assert.ok(out.intent.kind === "refusal" && out.intent.message.includes("$250"));
});

test("the coin on screen is known by name, plurals included, and still asks $ or tokens", () => {
  const ctx = { symbol: "DezX", label: "BONK", interval: "1h" as const, hasPosition: false };
  assert.equal(compile("buy 100 bonk", ctx).intent.kind, "clarify");
  assert.equal(compile("buy me six solanas", { ...ctx, label: "SOL" }).intent.kind, "clarify");
});

test("a sentence the grammar only half read goes to the model, not to a half order", () => {
  // Found live: the stop parsed, the $10 buy was dropped without a word.
  const out = compile("put ten bucks in and cut me if it drops ten percent", CTX);
  assert.equal(out.intent.kind, "refusal");
  if (out.intent.kind === "refusal") assert.equal(out.intent.reason, "notUnderstood");
});

test("a spoken order with a stop 'of' a percent and a target said as 'one twenty'", () => {
  // Found live, 19 Sep 2026: the stop was dropped and the target armed at $21.
  const out = compile(
    "buy me fifty dollars of solana at the current market price and put a stop loss of negative ten percent and set a target price of one twenty dollars",
    CTX,
  );
  assert.equal(out.intent.kind, "order");
  if (out.intent.kind !== "order") return;
  assert.deepEqual(out.intent.spec.entry?.amount, { kind: "usd", value: 50 });
  assert.equal(out.intent.spec.entry?.trigger, null);
  assert.deepEqual(
    out.intent.spec.exits.map((x) => x.trigger),
    [
      { kind: "drawdownFromEntry", percent: 10 },
      { kind: "priceAbsolute", value: 120 },
    ],
  );
});

test("a dollar figure used as a target price counts as read", () => {
  assert.equal(compile("sell half at $250", { ...CTX, hasPosition: true }).intent.kind, "order");
  assert.equal(compile("sell half at two fifty dollars", { ...CTX, hasPosition: true }).intent.kind, "order");
});

test("a price said on the market-cap scale is read on it", () => {
  /*
   * Reported live, 24 Sep 2026:
   *
   *   "buy me $100 of CASH at 128.8 million and sell 70% at 128.7 million
   *    and 100% at 128.9 million"
   *
   * 128.8M is CASH's market cap to four figures. Read as a price against a $1
   * token it is 12,886,134,811% above the market, so cipher refused it four
   * times in one breath — once for the entry and once per exit — for a
   * sentence that said nothing wrong.
   */
  const CASH = {
    symbol: "CASH",
    label: "CASH",
    interval: "1h" as const,
    hasPosition: true,
    price: 0.9996055159131537,
    cap: 128_781_635.88,
    heldQty: 1e6,
  };
  const out = compile(
    "buy me $100 of cash at 128.8 million and sell 70% at 128.7 million and 100% at 128.9 million",
    CASH,
  );
  assert.equal(out.intent.kind, "order");
  if (out.intent.kind !== "order") return;
  const { entry, exits, warnings } = out.intent.spec;
  assert.ok(entry?.trigger?.kind === "priceAbsolute" && Math.abs(entry.trigger.value - 0.9997) < 1e-3);
  assert.equal(exits.length, 2);
  for (const x of exits) {
    assert.ok(x.trigger.kind === "priceAbsolute" && x.trigger.value > 0.99 && x.trigger.value < 1.01);
  }
  /* Said out loud: a conversion nobody mentions is one nobody can catch. */
  const spec = out.intent.spec;
  assert.ok(spec.conversions?.some((c) => /market cap/i.test(c.note)));
  /* A CONVERSION, NOT A WARNING. As a warning this compiled perfectly and was
     then refused in production — choose() treats any warning as a lost part
     of the sentence, and the half-read guard saw 128.8M said and absent from
     the order. The test that mattered was never "does it compile", it was
     "does the path the app runs accept it". */
  assert.equal(warnings.length, 0);
  const text = "buy me $100 of cash at 128.8 million and sell 70% at 128.7 million and 100% at 128.9 million";
  assert.equal(choose(out, null, text).intent.kind, "order");
});

test("a target said as a percentage survives the half-read guard", () => {
  /* +30% is stored as 1.3x, and the guard looked for "30" in the order and
     refused it. A multiple and a percentage gain are the same statement. */
  const ctx = { symbol: "SOL", label: "SOL", interval: "1h" as const, hasPosition: false, price: 150 };
  const text = "buy $500 of sol, stop at 20% and target at 50%";
  assert.equal(choose(compile(text, ctx), null, text).intent.kind, "order");
});

test("with no cap in context, every number stays a price", () => {
  /* A market with no cap figure behaves exactly as it did before — the
     conversion is additive, never a reinterpretation of what already worked. */
  const noCap = { symbol: "SOL", label: "SOL", interval: "1h" as const, hasPosition: true, price: 118 };
  const out = compile("buy $500 of sol at 100", noCap);
  assert.equal(out.intent.kind, "order");
  if (out.intent.kind !== "order") return;
  assert.deepEqual(out.intent.spec.entry?.trigger, { kind: "priceAbsolute", value: 100 });
  assert.equal(out.intent.spec.warnings.length, 0);
});

test("a sentence that mixes scales is left alone rather than half-converted", () => {
  /* One number reading as a cap and another as a price is likelier a typo than
     a genuine mix, and converting half a ladder would reorder it — turning a
     stop into a target by arithmetic nobody asked for. */
  const CASH = {
    symbol: "CASH", label: "CASH", interval: "1h" as const, hasPosition: true,
    price: 0.9996, cap: 128_781_635.88, heldQty: 1e6,
  };
  const out = compile("buy $100 of cash at 0.99 and sell at 128.8 million", CASH);
  if (out.intent.kind !== "order") return;
  assert.deepEqual(out.intent.spec.entry?.trigger, { kind: "priceAbsolute", value: 0.99 });
  assert.equal(out.intent.spec.warnings.length, 0, "a mixed-scale sentence converts nothing");
});

test("a size with no verb is a buy only when a sell is impossible", () => {
  /*
   * "$100 of cash stop at 10% target at 30%" — reported live, 24 Sep 2026.
   * The exits read and the $100 did not, because nothing says "buy".
   *
   * Inferring a side is guessing, and guessing direction is the one mistake
   * cipher cannot make: buying when somebody meant to sell is the opposite
   * trade, not a near miss. So it fires only with an EMPTY position, where a
   * sell is impossible — every sell needs the tokens — and there is no second
   * reading to choose between.
   */
  const base = { symbol: "CASH", label: "CASH", interval: "1h" as const, price: 1 };

  const flat = compile("$100 of cash stop at 10% target at 30%", { ...base, hasPosition: false });
  assert.equal(flat.intent.kind, "order");
  if (flat.intent.kind === "order") {
    assert.equal(flat.intent.spec.entry?.side, "buy");
    assert.deepEqual(flat.intent.spec.entry?.amount, { kind: "usd", value: 100 });
    assert.equal(flat.intent.spec.exits.length, 2);
  }

  /* Holding it makes the sentence genuinely ambiguous, and an ambiguous side
     is never resolved by a coin flip. */
  const holding = compile("$100 of cash stop at 10% target at 30%", { ...base, hasPosition: true });
  assert.notEqual(holding.intent.kind, "order");
});
