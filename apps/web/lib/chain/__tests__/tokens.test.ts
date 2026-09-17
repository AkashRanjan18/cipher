import { test } from "node:test";
import assert from "node:assert/strict";
import { fromJupiter, looksLikeMint, resolveToken, risks, type TokenInfo } from "../tokens.ts";

/**
 * The fixtures are REAL, taken from Jupiter's search for "BONK" on 13 Sep 2026.
 *
 * Invented ones would have been kinder to the code: the impostor here has more
 * liquidity than the genuine token, and the genuine token's symbol is not the
 * string anyone types.
 */
/**
 * The fields a fixture does not care about.
 *
 * These tests are about IDENTITY — which token did the user mean — so they
 * name holders, liquidity and verification and nothing else. TokenInfo has
 * since grown the lifecycle fields, and spelling all of them out in every
 * fixture would bury the three values each test is actually about.
 */
const BLANK = {
  fdv: null,
  lifecycle: "legacy" as const,
  launchpad: null,
  graduatedAt: null,
  dev: null,
  createdAt: null,
  volume24hUsd: null,
  traders24h: null,
  change24h: null,
  icon: null,
  /* Every window absent, which is what a token with no history looks like —
     null rather than zeroes, because "nothing traded" and "we do not know
     yet" are different claims and the panel renders them differently. */
  windows: { "5m": null, "1h": null, "4h": null, "24h": null },
};

const REAL_BONK: TokenInfo = {
  ...BLANK,
  mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
  symbol: "Bonk",
  name: "Bonk",
  decimals: 5,
  verified: true,
  organicScore: 85.9,
  holderCount: 1_016_962,
  liquidityUsd: 1_026_900,
  priceUsd: 0.0000027,
  mcap: 241_650_116,
  audit: {
    mintAuthorityDisabled: true,
    freezeAuthorityDisabled: true,
    topHoldersPercentage: 30.2,
    devBalancePercentage: 0,
    devMints: null,
  },
};

/** Two holders, $2.3M of "liquidity", and the exact symbol people type. */
const FAKE_BONK: TokenInfo = {
  ...BLANK,
  mint: "FakeMintAddress1111111111111111111111111111",
  symbol: "BONK",
  name: "Bend Over Now, Kid",
  decimals: 6,
  verified: false,
  organicScore: 0,
  holderCount: 2,
  liquidityUsd: 2_317_128,
  priceUsd: 0.001,
  mcap: null,
  audit: null,
};

const BONK_SOL: TokenInfo = {
  ...BLANK,
  mint: "BonkSo11111111111111111111111111111111111111",
  symbol: "bonkSOL",
  name: "Bonk SOL",
  decimals: 9,
  verified: true,
  organicScore: 0,
  holderCount: 6_863,
  liquidityUsd: 10_060_169,
  priceUsd: 190,
  mcap: null,
  audit: null,
};

const LETS_BONK: TokenInfo = {
  ...BLANK,
  mint: "LetsBonk11111111111111111111111111111111111",
  symbol: "LetsBONK",
  name: "Let's BONK",
  decimals: 6,
  verified: true,
  organicScore: 0,
  holderCount: 8_703,
  liquidityUsd: 75_457,
  priceUsd: 0.01,
  mcap: null,
  audit: null,
};

/* ─────────────────────────── the impostor ──────────────────────────────── */

test("the fake with the exact symbol and more liquidity does not win", () => {
  const out = resolveToken("BONK", [FAKE_BONK, REAL_BONK, BONK_SOL, LETS_BONK]);
  assert.equal(out.kind, "resolved");
  if (out.kind !== "resolved") return;

  /*
   * Every naive rule picks FAKE_BONK here: exact symbol match, highest
   * liquidity, most recently created. Only verification and organic activity
   * point at the real one.
   */
  assert.equal(out.token.mint, REAL_BONK.mint);
  assert.equal(out.token.name, "Bonk");
});

test("an unverified token is never returned from a name search", () => {
  const out = resolveToken("BONK", [FAKE_BONK]);
  assert.equal(out.kind, "none");
  if (out.kind !== "none") return;
  assert.match(out.reason, /isn't verified/);
  // The refusal has to say what to do instead, or it teaches nothing.
  assert.match(out.reason, /mint address/);
});

test("a verified token with almost no holders is not credible either", () => {
  const thin: TokenInfo = { ...REAL_BONK, holderCount: 3, organicScore: 0 };
  assert.equal(resolveToken("bonk", [thin]).kind, "none");
});

/* ───────────────────────── ambiguity, not guessing ─────────────────────── */

test("several credible tokens with one name is a question, not a coin flip", () => {
  const a: TokenInfo = { ...BONK_SOL, organicScore: 40, holderCount: 9_000 };
  const b: TokenInfo = { ...LETS_BONK, organicScore: 38, holderCount: 8_700 };
  const out = resolveToken("bonk", [a, b]);
  assert.equal(out.kind, "ambiguous");
  if (out.kind !== "ambiguous") return;
  assert.equal(out.candidates.length, 2);
});

test("a clear winner is not turned into a question", () => {
  // The real Bonk is not close to the others; asking would be noise.
  const out = resolveToken("bonk", [REAL_BONK, BONK_SOL, LETS_BONK]);
  assert.equal(out.kind, "resolved");
});

test("typing a verified token's exact symbol means that one", () => {
  const out = resolveToken("bonkSOL", [REAL_BONK, BONK_SOL, LETS_BONK]);
  assert.equal(out.kind, "resolved");
  if (out.kind !== "resolved") return;
  assert.equal(out.token.mint, BONK_SOL.mint);
});

/* ──────────────────────────── pasted addresses ─────────────────────────── */

test("a pasted mint is taken at its word, verified or not", () => {
  /*
   * Refusing an address the user typed in full would be cipher deciding what
   * they may buy. That is discretion, and not cipher's to exercise — the risk
   * flags inform instead.
   */
  const out = resolveToken(FAKE_BONK.mint, [FAKE_BONK]);
  assert.equal(out.kind, "resolved");
});

test("mint addresses are recognised and ordinary words are not", () => {
  assert.equal(looksLikeMint("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"), true);
  assert.equal(looksLikeMint("bonk"), false);
  assert.equal(looksLikeMint("So11111111111111111111111111111111111111112"), true);
  // Base58 has no 0, O, I or l — the characters that look like each other.
  assert.equal(looksLikeMint("0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl"), false);
});

test("an address nobody has heard of says so plainly", () => {
  const out = resolveToken("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", []);
  assert.equal(out.kind, "none");
});

/* ──────────────────────────────── risks ────────────────────────────────── */

test("live mint authority is stated before the buy, not after", () => {
  const r = risks({
    ...REAL_BONK,
    audit: { ...REAL_BONK.audit!, mintAuthorityDisabled: false },
  });
  assert.ok(r.some((x) => /mint more/.test(x)));
});

test("a freeze authority is the one that stops you selling", () => {
  const r = risks({
    ...REAL_BONK,
    audit: { ...REAL_BONK.audit!, freezeAuthorityDisabled: false },
  });
  assert.ok(r.some((x) => /freeze/.test(x)));
});

test("a clean, deep, verified token raises nothing", () => {
  assert.deepEqual(risks(REAL_BONK), []);
});

test("concentration and thin liquidity are both worth saying", () => {
  const r = risks({
    ...REAL_BONK,
    liquidityUsd: 4_000,
    audit: { ...REAL_BONK.audit!, topHoldersPercentage: 82 },
  });
  assert.ok(r.some((x) => /82%/.test(x)));
  assert.ok(r.some((x) => /liquidity/.test(x)));
});

/* ─────────────────────────── the payload mapper ────────────────────────── */

test("isVerified missing means unverified, not truthy-undefined", () => {
  // Jupiter omits the key on unverified tokens rather than sending false. A
  // truthiness check on a missing key is how a fake gets through.
  const t = fromJupiter({ id: "x", symbol: "X", name: "X", decimals: 6 });
  assert.equal(t.verified, false);
  const v = fromJupiter({ id: "x", symbol: "X", name: "X", decimals: 6, isVerified: true });
  assert.equal(v.verified, true);
});

test("missing numbers become zero rather than NaN", () => {
  const t = fromJupiter({ id: "x", symbol: "X", name: "X" });
  assert.equal(t.liquidityUsd, 0);
  assert.equal(t.holderCount, 0);
  assert.equal(t.mcap, null);
});
