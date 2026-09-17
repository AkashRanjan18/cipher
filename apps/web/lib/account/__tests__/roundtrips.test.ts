import { test } from "node:test";
import assert from "node:assert/strict";
import { openAccount, execute, type Account } from "../paper.ts";
import { roundTrips } from "../roundtrips.ts";

/**
 * Driven through execute() rather than with hand-built fills.
 *
 * A fabricated Fill array can assert anything, including a shape the ledger
 * never produces. Every trip below is the residue of real trades against the
 * real ledger, which is the only way this can be evidence that the closed list
 * agrees with the account it claims to describe.
 */
const MINT = "So11111111111111111111111111111111111111112";
const OTHER = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

let clock = 1_700_000_000;

function trade(
  a: Account,
  side: "buy" | "sell",
  qty: number,
  mark: number,
  mint = MINT,
): Account {
  const r = execute(a, { mint, side, qty, mark, ts: (clock += 60) });
  assert.ok("account" in r, "refusal" in r ? r.refusal : "no account");
  return r.account;
}

test("a position opened and closed becomes one round trip", () => {
  let a = openAccount(100_000);
  a = trade(a, "buy", 100, 100);
  a = trade(a, "sell", 100, 150);

  const trips = roundTrips(a.fills);
  assert.equal(trips.length, 1);
  assert.equal(trips[0].mint, MINT);
  assert.equal(trips[0].qtyBought, 100);
  assert.equal(trips[0].fills, 2);
});

test("realised P&L matches what the ledger booked, to the cent", () => {
  let a = openAccount(100_000);
  a = trade(a, "buy", 100, 100);
  a = trade(a, "sell", 40, 130);
  a = trade(a, "sell", 60, 150);

  const trips = roundTrips(a.fills);
  assert.equal(trips.length, 1);
  /* The account's own running total is the reference. If these ever disagree
     the panel is telling a different story from the balance. */
  assert.ok(Math.abs(trips[0].realisedUsd - a.realisedUsd) < 1e-9);
});

test("a still-open position produces no trip at all", () => {
  let a = openAccount(100_000);
  a = trade(a, "buy", 100, 100);
  a = trade(a, "sell", 30, 120);

  assert.equal(roundTrips(a.fills).length, 0);
});

test("buying more extends the same trip; buying back starts a new one", () => {
  let a = openAccount(100_000);
  a = trade(a, "buy", 50, 100);
  a = trade(a, "buy", 50, 110); // still one position, one average cost
  a = trade(a, "sell", 100, 120); // flat — trip one ends
  a = trade(a, "buy", 10, 120);
  a = trade(a, "sell", 10, 130); // trip two

  const trips = roundTrips(a.fills);
  assert.equal(trips.length, 2);
  assert.equal(trips[0].qtyBought, 100);
  assert.equal(trips[0].fills, 3);
  assert.equal(trips[1].qtyBought, 10);
});

test("two coins held at once keep their trips apart", () => {
  let a = openAccount(100_000);
  a = trade(a, "buy", 100, 100, MINT);
  a = trade(a, "buy", 200, 5, OTHER);
  a = trade(a, "sell", 200, 6, OTHER); // OTHER closes first
  a = trade(a, "sell", 100, 90, MINT);

  const trips = roundTrips(a.fills);
  assert.equal(trips.length, 2);
  /* Ordered by when they CLOSED, not by when they opened. */
  assert.equal(trips[0].mint, OTHER);
  assert.equal(trips[1].mint, MINT);
  assert.ok(trips[0].realisedUsd > 0);
  assert.ok(trips[1].realisedUsd < 0);
});

test("a crumb left behind still closes the trip", () => {
  let a = openAccount(100_000);
  a = trade(a, "buy", 100, 100);
  /* Just short of everything: the remainder is worth a fraction of a cent, so
     execute() writes it off and deletes the position. The closed list has to
     agree, or this trip stays open forever against nothing. */
  a = trade(a, "sell", 100 - 1e-7, 120);

  assert.equal(Object.keys(a.positions).length, 0);
  assert.equal(roundTrips(a.fills).length, 1);
});

test("invested is the cash that left, proceeds the cash that came back", () => {
  let a = openAccount(100_000);
  const before = a.usdc;
  a = trade(a, "buy", 100, 100);
  const afterBuy = a.usdc;
  a = trade(a, "sell", 100, 150);
  const afterSell = a.usdc;

  const [trip] = roundTrips(a.fills);
  assert.ok(Math.abs(trip.investedUsd - (before - afterBuy)) < 1e-9);
  assert.ok(Math.abs(trip.proceedsUsd - (afterSell - afterBuy)) < 1e-9);
});

test("return is measured on the cash committed", () => {
  let a = openAccount(100_000);
  a = trade(a, "buy", 100, 100);
  a = trade(a, "sell", 100, 200);

  const [trip] = roundTrips(a.fills);
  assert.ok(trip.returnPct !== null);
  /* Roughly a double, minus two commissions and two crossings of the spread.
     The band is wide on purpose: this asserts the sign and the magnitude, not
     the fee schedule, which paper.test.ts already owns. */
  assert.ok(trip.returnPct! > 90 && trip.returnPct! < 100);
});

test("no fills, no trips", () => {
  assert.deepEqual(roundTrips([]), []);
});
