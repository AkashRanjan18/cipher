import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { database, type Harness } from "../../db/__tests__/harness.ts";
import { ensureUser, loadAccount } from "../../db/accounts.ts";
import { quote, qtyForBudget, feeFor } from "../../account/paper.ts";
import {
  applyReferral,
  ensureProfile,
  feedFor,
  maskAmounts,
  publicTrades,
  referralSummary,
  setFollow,
  statsOf,
  updateProfile,
} from "../profiles.ts";

/*
 * The social layer against a real Postgres. Every number here comes from a
 * row in `fills` — the tests prove the promises users rely on: hidden amounts
 * never leave the server, the feed is only real trades of people you follow,
 * and a referral is the fee schedule's and cannot be gamed.
 */

const SOL = "So11111111111111111111111111111111111111112";
const ALICE = "did:privy:alice";
const BOB = "did:privy:bob";
let h: Harness;

before(async () => {
  h = await database();
});
after(async () => {
  await h.close();
});
beforeEach(async () => {
  await h.reset();
  for (const u of [ALICE, BOB]) await ensureUser(u);
});

async function fill(user: string, id: string, side: "buy" | "sell", qty: number, price: number, fee: number, realised = 0, squawk = "") {
  await h.pg.query(
    `insert into fills (id, user_id, ts, mint, side, qty, price, fee_usd, realised_usd, squawk, source)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'sana')`,
    [id, user, 1_700_000_000 + Number(id.replace(/\D/g, "") || 0), SOL, side, qty, price, fee, realised, squawk],
  );
}

test("a profile is created with a generated handle, never one taken from the email", async () => {
  const p = await ensureProfile(ALICE);
  assert.match(p.handle, /^trader_[a-z0-9]{6}$/);
  assert.equal((await ensureProfile(ALICE)).handle, p.handle, "created once");
});

test("handles are validated and unique", async () => {
  await ensureProfile(BOB);
  assert.ok("profile" in (await updateProfile(ALICE, { handle: "Alice_1" })));
  assert.equal((await ensureProfile(ALICE)).handle, "alice_1", "lowercased");
  assert.ok("error" in (await updateProfile(BOB, { handle: "alice_1" })), "taken");
  assert.ok("error" in (await updateProfile(BOB, { handle: "no spaces" })), "invalid");
  assert.ok("error" in (await updateProfile(BOB, { handle: "ab" })), "too short");
});

test("everything is public by default; hiding amounts removes sizes, dollars and the dollars in the sentence", async () => {
  await ensureProfile(ALICE);
  await fill(ALICE, "f1", "buy", 5, 100, 2.5, 0, "buy $500 of sol and stop at 10%");
  await fill(ALICE, "f2", "sell", 5, 120, 3, 94.5);

  const open = await publicTrades(ALICE);
  const buy = open.find((t) => t.id === "f1")!;
  assert.equal(buy.qty, 5);
  assert.equal(buy.valueUsd, 500);
  assert.equal(buy.sentence, "buy $500 of sol and stop at 10%");
  const sell = open.find((t) => t.id === "f2")!;
  assert.equal(sell.realisedUsd, 94.5);
  assert.ok(sell.realisedPct !== null && Math.abs(sell.realisedPct - 18.9) < 0.1, `pct ${sell.realisedPct}`);

  await updateProfile(ALICE, { hideAmounts: true });
  const hidden = await publicTrades(ALICE);
  const hb = hidden.find((t) => t.id === "f1")!;
  assert.equal(hb.qty, null);
  assert.equal(hb.valueUsd, null);
  assert.equal(hb.sentence, "buy $••• of sol and stop at 10%");
  assert.equal(hb.price, 100, "price stays: it says nothing about size");
  const hs = hidden.find((t) => t.id === "f2")!;
  assert.equal(hs.realisedUsd, null);
  assert.ok(hs.realisedPct !== null, "the percentage stays");
  assert.equal((await statsOf(ALICE, true)).realisedUsd, null);
});

test("amounts are masked in every spoken form", () => {
  assert.equal(maskAmounts("buy $1.5k of bonk"), "buy $••• of bonk");
  assert.equal(maskAmounts("ape 500 dollars into wif"), "ape ••• into wif");
  assert.equal(maskAmounts("sell 2 tokens of sol at $150"), "sell ••• of sol at $•••");
});

test("the feed is the trades of people you follow, and only theirs", async () => {
  const a = await ensureProfile(ALICE);
  await ensureProfile(BOB);
  await fill(ALICE, "f1", "buy", 1, 100, 0.95);
  await fill(BOB, "f2", "buy", 1, 100, 0.95);

  assert.deepEqual(await feedFor(BOB), [], "following nobody: an empty feed, not a padded one");
  assert.ok("ok" in (await setFollow(BOB, a.handle, true)));
  assert.deepEqual((await feedFor(BOB)).map((t) => t.id), ["f1"]);
  assert.equal((await statsOf(ALICE, false)).followers, 1);

  assert.ok("error" in (await setFollow(ALICE, a.handle, true)), "not yourself");
  await setFollow(BOB, a.handle, false);
  assert.deepEqual(await feedFor(BOB), []);
});

test("a referral: once, not your own, only before the first trade — and 10% off every fee", async () => {
  const a = await ensureProfile(ALICE);
  const b = await ensureProfile(BOB);

  assert.ok("error" in (await applyReferral(ALICE, a.referralCode)), "own code");
  assert.ok("error" in (await applyReferral(BOB, "nosuchcode")), "unknown code");
  assert.ok("ok" in (await applyReferral(BOB, a.referralCode)));
  assert.ok("error" in (await applyReferral(BOB, a.referralCode)), "only once");

  /* The account now carries the discount, and the ledger charges it. */
  const acct = (await loadAccount(BOB, false))!;
  assert.equal(acct.feeDiscount, 0.1);
  const q = quote({ ...acct, usdc: 10_000 }, SOL, "buy", 5, 100, {});
  assert.ok(Math.abs(q.feeUsd - feeFor(q.notionalUsd) * 0.9) < 1e-9, `fee ${q.feeUsd}`);
  /* "$500" still spends exactly $500 with the discount. */
  const qty = qtyForBudget(500, 100, 0.1);
  const q2 = quote({ ...acct, usdc: 10_000 }, SOL, "buy", qty, 100, { quoted: { price: 100, impactBps: 0, route: "" } });
  assert.ok(Math.abs(q2.cashUsd - 500) < 1e-6, `spent ${q2.cashUsd}`);

  /* A trader who already traded cannot pick up a code later. */
  await fill(ALICE, "f9", "buy", 1, 100, 0.95);
  assert.ok("error" in (await applyReferral(ALICE, b.referralCode)));
});

test("the referrer earns 25% of the fees their invitees pay, summed from fills", async () => {
  const a = await ensureProfile(ALICE);
  await ensureProfile(BOB);
  await applyReferral(BOB, a.referralCode);
  await fill(BOB, "f1", "buy", 5, 100, 2.25);
  await fill(BOB, "f2", "sell", 5, 110, 2.475, 45);
  const s = await referralSummary(ALICE);
  assert.equal(s.invitees, 1);
  assert.ok(Math.abs(s.feesUsd - 4.725) < 1e-9);
  assert.ok(Math.abs(s.earnedUsd - 1.18125) < 1e-9);
  assert.equal((await referralSummary(BOB)).referred, true);
});
