import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { discover, launchRisks, isFeed, FEEDS } from "../discover.ts";
import { fromJupiter, lifecycleOf } from "../tokens.ts";

/**
 * The coin universe, against recorded Jupiter payloads.
 *
 * The shapes below are real rows pulled from lite-api.jup.ag while this was
 * written — a two-minute-old pump.fun token still on its curve, a graduated
 * one, and a legacy token with no launchpad at all. Recorded rather than
 * fetched, because a test that depends on what launched today fails tomorrow
 * for a reason that has nothing to do with the code.
 */

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Two minutes old, still on the curve. Dev has minted 422 tokens. */
const BONDING = {
  id: "6B6jUyXqW5oG7qDLAhWPiqWNCSFe47pL86N3dcg9pump",
  name: "ALEX CLAIMED FEES",
  symbol: "Flybook",
  decimals: 6,
  dev: "56iuciFxEerQf71ufYzsLQxsTKGFf5oYf9kkFKHdFuaW",
  launchpad: "pump.fun",
  createdAt: "2026-09-14T00:01:38Z",
  audit: { mintAuthorityDisabled: true, freezeAuthorityDisabled: true, devMints: 422 },
  organicScore: 0,
  tags: ["unknown"],
};

/** Filled its curve and migrated to a real pool. */
const GRADUATED = {
  id: "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump",
  name: "Ansem",
  symbol: "ANSEM",
  decimals: 6,
  launchpad: "pump.fun",
  graduatedAt: "2026-06-16T21:05:48Z",
  graduatedPool: "8BnEgHoWFysVcuFFX7QztDmzuH8r5ZFvyP3sYwn1XTh6",
  isVerified: true,
  holderCount: 24_512,
  liquidity: 412_000,
  usdPrice: 0.0032,
  mcap: 3_200_000,
  fdv: 3_200_000,
  stats24h: { buyVolume: 120_000, sellVolume: 98_000, numTraders: 1_430 },
  audit: { mintAuthorityDisabled: true, freezeAuthorityDisabled: true, devMints: 1 },
};

/** Never had a launchpad. */
const LEGACY = {
  id: "So11111111111111111111111111111111111111112",
  name: "Wrapped SOL",
  symbol: "SOL",
  decimals: 9,
  isVerified: true,
  holderCount: 3_200_000,
  liquidity: 40_000_000,
  usdPrice: 101.4,
  mcap: 60_000_000_000,
};

function serve(rows: unknown[]): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(rows), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
}

/* ─────────────────────────────── lifecycle ─────────────────────────────── */

test("the three stages come from launchpad and graduatedAt, nothing else", () => {
  assert.equal(lifecycleOf(BONDING), "bonding");
  assert.equal(lifecycleOf(GRADUATED), "graduated");
  assert.equal(lifecycleOf(LEGACY), "legacy");
});

test("a graduated token is not filed as bonding just because it kept its launchpad", () => {
  /*
   * The whole point of checking graduation first. ANSEM still says
   * `launchpad: "pump.fun"` years after it left the curve, and reading that
   * field alone would file every graduated token as still in a closed system
   * — which is the exact distinction a user asking for "graduated" means.
   */
  assert.equal(GRADUATED.launchpad, "pump.fun");
  assert.equal(lifecycleOf(GRADUATED), "graduated");
});

test("the fields that were being thrown away now survive the mapping", () => {
  const t = fromJupiter(GRADUATED);
  assert.equal(t.lifecycle, "graduated");
  assert.equal(t.launchpad, "pump.fun");
  assert.equal(t.graduatedAt, "2026-06-16T21:05:48Z");
  assert.equal(t.fdv, 3_200_000);
  assert.equal(t.audit?.devMints, 1);
});

test("24h volume is both sides added, because Jupiter reports them apart", () => {
  assert.equal(fromJupiter(GRADUATED).volume24hUsd, 218_000);
  assert.equal(fromJupiter(GRADUATED).traders24h, 1_430);
});

test("a token with no stats reports null rather than zero", () => {
  // Zero volume and unknown volume are different claims, and a brand-new
  // token has the second one.
  assert.equal(fromJupiter(LEGACY).volume24hUsd, null);
  assert.equal(fromJupiter(LEGACY).traders24h, null);
});

/* ──────────────────────────────── the feeds ────────────────────────────── */

test("every feed name maps to a real Jupiter path", () => {
  assert.deepEqual(Object.keys(FEEDS).sort(), ["new", "organic", "traded"]);
  assert.equal(isFeed("new"), true);
  assert.equal(isFeed("nonsense"), false);
});

test("a feed returns every stage when no filter is asked for", async () => {
  serve([BONDING, GRADUATED, LEGACY]);
  const all = await discover("traded");
  assert.deepEqual(all.map((t) => t.lifecycle), ["bonding", "graduated", "legacy"]);
});

test("filtering to one stage keeps only that stage", async () => {
  serve([BONDING, GRADUATED, LEGACY]);
  const bonding = await discover("new", { lifecycle: "bonding" });
  assert.deepEqual(bonding.map((t) => t.symbol), ["Flybook"]);
});

test("rows that are not tokens are dropped rather than mapped to an empty one", async () => {
  serve([BONDING, null, "junk", {}, GRADUATED]);
  const out = await discover("traded");
  assert.deepEqual(out.map((t) => t.symbol), ["Flybook", "ANSEM"]);
});

test("a non-array body is empty, not a crash", async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: "nope" }), { status: 200 })) as typeof fetch;
  assert.deepEqual(await discover("traded"), []);
});

test("an upstream failure throws rather than returning an empty universe", async () => {
  globalThis.fetch = (async () => new Response("rate limited", { status: 429 })) as typeof fetch;
  // Empty and unavailable are different answers. A list that silently comes
  // back empty reads as "nothing launched", which is never true.
  await assert.rejects(() => discover("new"), /429/);
});

test("the limit is honoured after filtering, not before", async () => {
  serve([BONDING, GRADUATED, BONDING, GRADUATED, BONDING]);
  const out = await discover("new", { lifecycle: "bonding", limit: 2 });
  assert.equal(out.length, 2);
  assert.ok(out.every((t) => t.lifecycle === "bonding"));
});

/* ─────────────────────────────── icons ─────────────────────────────────── */

test("an icon on a gateway that refuses to serve is rerouted, CID untouched", () => {
  /*
   * Measured, not assumed: fifteen of twenty graduated tokens had an icon
   * that would not load, and every one was on ipfs.io or dweb.link — both of
   * which return 429 to a single cold request. On screen that is
   * indistinguishable from having no icon, so half the list wore a grey
   * letter for no reason a user could see.
   */
  const cid = "bafkreihsdoqkmpr5ryebaduoutyhj3nxco6wdp4s4743l2qrae4sz4hqrm";
  const t = fromJupiter({ ...BONDING, icon: `https://ipfs.io/ipfs/${cid}` });
  assert.equal(t.icon, `https://ipfs.filebase.io/ipfs/${cid}`);

  const d = fromJupiter({ ...BONDING, icon: `https://dweb.link/ipfs/${cid}` });
  assert.equal(d.icon, `https://ipfs.filebase.io/ipfs/${cid}`);
});

test("an icon anywhere else is left exactly as it came", () => {
  const url = "https://raw.githubusercontent.com/solana-labs/token-list/main/x/logo.png";
  assert.equal(fromJupiter({ ...BONDING, icon: url }).icon, url);
  assert.equal(fromJupiter({ ...BONDING, icon: "" }).icon, null);
  assert.equal(fromJupiter({ ...BONDING }).icon, null);
});

/* ────────────────────────────── launch risks ───────────────────────────── */

test("a serial launcher is named, with the number", () => {
  const warnings = launchRisks(fromJupiter(BONDING));
  assert.ok(warnings.some((w) => /422 tokens/.test(w)), warnings.join(" | "));
});

test("live mint and freeze authority are each called out", () => {
  const risky = fromJupiter({
    ...BONDING,
    audit: { mintAuthorityDisabled: false, freezeAuthorityDisabled: false, devMints: 1 },
  });
  const warnings = launchRisks(risky);
  assert.ok(warnings.some((w) => /Mint authority/.test(w)));
  assert.ok(warnings.some((w) => /Freeze authority/.test(w)));
});

test("bonding is itself a warning, because there is no pool behind the price", () => {
  assert.ok(launchRisks(fromJupiter(BONDING)).some((w) => /bonding curve/.test(w)));
});

test("an established token is NOT accused because of its launchpad's deployer", () => {
  /*
   * Caught against live data, not imagined. USELESS — $214M cap, 61,272
   * holders — was flagged "this dev has minted 814 tokens", and STONK at
   * $183M with 8,343. That number is a shared launchpad deployer, and even if
   * it were not, a token the market has already judged does not need a
   * sentence about who deployed it. A warning that is wrong is worse than no
   * warning, because the user learns to ignore all of them.
   */
  const useless = fromJupiter({
    ...GRADUATED,
    symbol: "USELESS",
    holderCount: 61_272,
    mcap: 214_400_000,
    audit: { mintAuthorityDisabled: true, freezeAuthorityDisabled: true, devMints: 814 },
  });
  assert.deepEqual(launchRisks(useless), []);
});

test("the same dev count DOES warn while the token is still on its curve", () => {
  // Where nothing else is known, it is the only fact there is.
  const fresh = fromJupiter({
    ...BONDING,
    audit: { mintAuthorityDisabled: true, freezeAuthorityDisabled: true, devMints: 814 },
  });
  assert.ok(launchRisks(fresh).some((w) => /814 tokens/.test(w)));
});

test("a clean graduated token warns about nothing", () => {
  assert.deepEqual(launchRisks(fromJupiter(GRADUATED)), []);
});
