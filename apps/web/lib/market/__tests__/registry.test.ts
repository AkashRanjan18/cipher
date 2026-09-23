import test from "node:test";
import assert from "node:assert/strict";
import { nearest, readScale, against, correctSentence, type RegistryToken } from "../registry.ts";

/** Shaped like the live file, with the figures that were actually in it. */
const tok = (p: Partial<RegistryToken> & Pick<RegistryToken, "symbol">): RegistryToken => ({
  mint: p.symbol,
  name: p.symbol,
  price: 1,
  cap: 1000,
  decimals: 9,
  verified: true,
  ...p,
});

const SOL = tok({
  symbol: "SOL",
  name: "Wrapped SOL",
  aliases: ["SOL", "Solana"],
  price: 118.61,
  cap: 75_262_700_000,
});
const BONK = tok({ symbol: "Bonk", name: "Bonk", price: 0.000_02, cap: 1_500_000_000 });
const ZCAT = tok({ symbol: "ZCAT", name: "Zcat", price: 0.0036, cap: 3_400_000 });
/** Real row from the built registry: a token whose whole market cap is $33. */
const DUST = tok({ symbol: "NOVBEAR", name: "NovBear", price: 1.65e-8, cap: 33 });
/** Unverified impostors, both live in the registry on 23 Sep 2026. */
const FAKE_SOL = tok({ symbol: "SOL", mint: "fake1", name: "sol", verified: false, cap: 18_075 });
const FAKE_BTC = tok({ symbol: "BTC", mint: "fake2", name: "Buy The Cat", verified: false });

const ALL = [SOL, BONK, ZCAT, DUST, FAKE_SOL, FAKE_BTC];

test("a misheard token name finds the token", () => {
  assert.equal(nearest("solana", ALL)?.token.mint, "SOL");
  // The whole point: one substitution from a recogniser.
  assert.equal(nearest("sulana", ALL)?.token.mint, "SOL");
  assert.equal(nearest("bonck", ALL)?.token.mint, "Bonk");
});

test('"Solana" is an alias, because the token is not called that', () => {
  /* Jupiter names the SOL mint "Wrapped SOL". The commonest word anybody could
     say for it appears nowhere in its own metadata, so before aliases the
     match failed outright. */
  assert.equal(nearest("solana", ALL)?.on, "alias");
  assert.equal(nearest("wrapped sol", ALL)?.token.mint, "SOL");
});

test("an impostor never wins while a verified token exists", () => {
  /* Both of these were in the live registry: a token whose symbol is SOL with
     a $18k cap, and one whose symbol is BTC called "Buy The Cat". This is the
     rug vector, and fuzzy matching is precisely the door it walks through. */
  assert.equal(nearest("sol", ALL)?.token.mint, "SOL");
  assert.equal(nearest("btc", ALL), null, "an unverified BTC must not resolve");
});

test("nothing like a token returns nothing", () => {
  assert.equal(nearest("zzzzz", ALL), null);
  assert.equal(nearest("", ALL), null);
});

test("a number is read as a price or a market cap, by which one it is near", () => {
  // The user's case, 23 Sep 2026: "buy zcat at 3.4 million" is a cap.
  const cap = readScale(3_400_000, ZCAT);
  assert.equal(cap.kind, "cap");
  assert.ok(cap.kind === "cap" && Math.abs(cap.price - 0.0036) < 1e-6);

  // And an ordinary price stays a price.
  assert.deepEqual(readScale(120, SOL), { kind: "price", price: 120 });

  // A cap said for a major resolves to the price it implies.
  const solCap = readScale(70_000_000_000, SOL);
  assert.equal(solCap.kind, "cap");
  assert.ok(solCap.kind === "cap" && Math.abs(solCap.price - 110.3) < 0.5);
});

test("a number near neither is refused rather than forced", () => {
  /*
   * NOVBEAR trades at $1.65e-8 with a $33 market cap, so every number a person
   * could say is astronomically far from both. With only a relative test,
   * "0.004" was read as a cap and silently became a price of 2e-12.
   */
  assert.equal(readScale(0.004, DUST).kind, "neither");
  assert.equal(readScale(3_400_000, DUST).kind, "neither");
  assert.equal(readScale(0, SOL).kind, "neither");
});

test("the open chart is the scope", () => {
  // Says the token that is open.
  assert.equal(against("zcat", ZCAT, ALL).kind, "open");
  // Near-miss on the open token is a mishearing, corrected and shown.
  const fixed = against("zcash", ZCAT, ALL);
  assert.equal(fixed.kind, "corrected");
  assert.ok(fixed.kind === "corrected" && fixed.token.mint === "ZCAT" && fixed.heard === "zcash");
  // A different, real token is not traded from this chart and not switched to.
  const other = against("solana", ZCAT, ALL);
  assert.equal(other.kind, "elsewhere");
  assert.ok(other.kind === "elsewhere" && other.token.mint === "SOL");
  // And a word that names nothing stays unknown.
  assert.equal(against("qqqqqq", ZCAT, ALL).kind, "unknown");
});

test("a misheard token in a spoken order is corrected to the open one", () => {
  const { text, changed } = correctSentence("buy $500 of zcash and stop at 0.003", ZCAT, ALL);
  assert.equal(text, "buy $500 of ZCAT and stop at 0.003");
  assert.deepEqual(changed, { from: "zcash", to: "ZCAT" });
});

test("only the token slot is rewritten, never the rest of the sentence", () => {
  /* A correction that scanned every word would rewrite "cut" or "rest" into
     whatever coin they resemble. The value of this is that the bar can be
     trusted, so it touches exactly the word the grammar reads as the token. */
  const out = correctSentence("sell 30% of my zcat at 0.0042 and cut the rest", ZCAT, ALL);
  assert.equal(out.text, "sell 30% of my zcat at 0.0042 and cut the rest");
  assert.equal(out.changed, null);
});

test("naming a different real token is reported, not silently switched", () => {
  const out = correctSentence("buy $500 of solana", ZCAT, ALL);
  assert.equal(out.changed, null, "the chart must not be switched underneath a sentence");
  assert.equal(out.elsewhere?.mint, "SOL");
  assert.equal(out.text, "buy $500 of solana");
});

test("a sentence with no token slot is left exactly as it is", () => {
  assert.equal(correctSentence("what is my pnl", ZCAT, ALL).text, "what is my pnl");
  assert.equal(correctSentence("stop at 0.003", ZCAT, ALL).changed, null);
});
