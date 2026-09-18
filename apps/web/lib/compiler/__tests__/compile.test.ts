import { MARKETS } from "../../market/markets.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { compile } from "../compile.ts";
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
