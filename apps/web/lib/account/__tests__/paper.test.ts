import { test } from "node:test";
import assert from "node:assert/strict";
import {
  openAccount,
  execute,
  quote,
  feeFor,
  fillPrice,
  equity,
  unrealised,
  resolveQty,
  maxBuyUsd,
  allInPrice,
  positionOf,
  heldMints,
  type Account,
} from "../paper.ts";

/**
 * These tests were written against a ledger that held one asset, and they are
 * the reason the migration to many is trustworthy — every one of them is a
 * statement about the money math that must survive the shape change.
 *
 * The helpers below keep them readable: MINT is the market under test, and
 * `sol()`/`basis()` read the position the old `sol(account)` used to be.
 */
const MINT = "So11111111111111111111111111111111111111112";
const OTHER = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

/** Units held in the market under test. */
function sol(a: Account): number {
  return positionOf(a, MINT).qty;
}

/** Average cost in the market under test. */
function basis(a: Account): number {
  return positionOf(a, MINT).costBasis;
}

/** One mark, for the market under test. */
function at(mark: number): Record<string, number> {
  return { [MINT]: mark };
}

/** Helper: execute and fail the test loudly if the order was refused. */
function fill(
  a: Account,
  side: "buy" | "sell",
  qty: number,
  mark: number,
  ts = 1_700_000_000,
  mint = MINT,
) {
  const r = execute(a, { mint, side, qty, mark, ts });
  if ("refusal" in r) throw new Error(`refused: ${r.refusal}`);
  return r;
}

test("the deposit is the whole account until something happens", () => {
  const a = openAccount(10_000);
  assert.equal(a.usdc, 10_000);
  assert.equal(sol(a), 0);
  assert.equal(equity(a, at(103)), 10_000);
  assert.equal(unrealised(a, MINT, 103), 0);
});

test("cipher's fee is 0.5% at every size — no minimum", () => {
  // No floor since 19 Sep 2026: 0.5% flat, at every size.
  assert.equal(feeFor(20), 0.1);
  assert.equal(feeFor(199), 0.995);
  assert.equal(feeFor(1_000), 5);
  // The floor and the rate cross at $190; nothing between them is cheaper than both.
  assert.ok(feeFor(199) < feeFor(200));
});

test("the spread is charged against the trader in both directions", () => {
  assert.ok(fillPrice(100, "buy") > 100);
  assert.ok(fillPrice(100, "sell") < 100);
});

test("a buy costs notional plus fee, and the fee lands in the cost basis", () => {
  const a = openAccount(10_000);
  const { account: b } = fill(a, "buy", 10, 100);

  const px = fillPrice(100, "buy"); // 100.10
  const notional = 10 * px; // 1001
  const fee = notional * 0.005; // 5.005

  assert.equal(b.usdc, 10_000 - notional - fee);
  assert.equal(sol(b), 10);
  assert.equal(basis(b), (notional + fee) / 10);
  assert.equal(b.feesUsd, fee);

  /*
   * The point of folding the fee in: a position opened at the current price
   * is DOWN, not flat. A screen that showed $0.00 here would be claiming
   * break-even at a price where selling loses money.
   */
  assert.ok(unrealised(b, MINT, 100) < 0);
});

test("a partial sale books its share of the basis and leaves the rest priced the same", () => {
  const a = openAccount(10_000);
  const { account: b } = fill(a, "buy", 10, 100);
  const perUnit = basis(b);

  const { account: c, fill: f } = fill(b, "sell", 4, 200);

  assert.equal(sol(c), 6);
  assert.equal(basis(c), perUnit, "the remaining position keeps its per-unit cost");
  assert.ok(f.realisedUsd > 0);
  assert.equal(c.realisedUsd, f.realisedUsd);

  // Realised is proceeds after fee, minus what those 4 SOL cost to acquire.
  const px = fillPrice(200, "sell");
  const proceeds = 4 * px - feeFor(4 * px);
  assert.equal(f.realisedUsd, proceeds - 4 * perUnit);
});

test("going flat resets the cost basis", () => {
  /*
   * This is the trailing-high-water-mark bug from the scanner, in a different
   * costume. Carry a basis across a round trip and the next position is
   * measured against a price from the last one — buy back in after a 2x and
   * the card opens showing a fictional 50% loss.
   */
  const a = openAccount(10_000);
  const { account: b } = fill(a, "buy", 10, 100);
  const { account: c } = fill(b, "sell", 10, 200);

  assert.equal(sol(c), 0);
  assert.equal(basis(c), 0);

  const { account: d } = fill(c, "buy", 1, 200);
  assert.ok(Math.abs(basis(d) - 200) < 5, "reopened at 200, not anchored to 100");
});

test("a round trip nets out to realised P&L minus every fee charged", () => {
  const a = openAccount(10_000);
  const { account: b } = fill(a, "buy", 10, 100);
  const { account: c } = fill(b, "sell", 10, 120);

  assert.equal(sol(c), 0);
  // Flat, so equity is pure cash and cash is the deposit plus what was made.
  assert.ok(Math.abs(equity(c, at(120)) - (10_000 + c.realisedUsd)) < 1e-9);
  // And the profit is smaller than the naive 20% by the spread and both fees.
  assert.ok(c.realisedUsd < 200);
  assert.ok(c.realisedUsd > 180);
});

test("it refuses rather than overdrawing", () => {
  const a = openAccount(100);
  const r = execute(a, { mint: MINT, side: "buy", qty: 10, mark: 100, ts: 1 });
  assert.ok("refusal" in r);
  assert.deepEqual(a, openAccount(100), "a refused order changes nothing");
});

test("it refuses rather than short-selling", () => {
  const a = openAccount(10_000);
  const { account: b } = fill(a, "buy", 1, 100);
  const r = execute(b, { mint: MINT, side: "sell", qty: 5, mark: 100, ts: 1 });
  assert.ok("refusal" in r);
  assert.match((r as { refusal: string }).refusal, /you hold/i);
});

test("a small sale pays 0.5%, not a dollar minimum", () => {
  const a = openAccount(10_000);
  const { account: b } = fill(a, "buy", 10, 100);
  const r = execute(b, { mint: MINT, side: "sell", qty: 0.1, mark: 100, ts: 1 });
  assert.ok(!("refusal" in r));
  if (!("refusal" in r)) assert.ok(r.fill.feeUsd < 0.06);
});

test("percentOfPosition only means something on a sell", () => {
  const a = openAccount(10_000);
  const { account: b } = fill(a, "buy", 10, 100);

  assert.equal(resolveQty({ kind: "percentOfPosition", value: 33 }, "sell", b, MINT, 100), 3.3);
  assert.equal(
    resolveQty({ kind: "percentOfPosition", value: 33 }, "buy", b, MINT, 100),
    null,
    "buying a third of your position is a misparse, not an order",
  );
});

test("a usd amount resolves through the fill price, not the mark", () => {
  const a = openAccount(10_000);
  const qty = resolveQty({ kind: "usd", value: 1_000 }, "buy", a, MINT, 100)!;
  // The $1,000 is the whole budget, fee included.
  assert.equal(qty, 1_000 / (fillPrice(100, "buy") * 1.005));
  assert.ok(qty < 10, "you get less than the chart price implies, because you do");
});

test("max buy is the largest order that is not refused", () => {
  for (const balance of [10_000, 500, 201, 150, 20, 1, 0.5]) {
    const a = openAccount(balance);
    const usd = maxBuyUsd(a);
    if (usd <= 0) continue;
    const qty = usd / fillPrice(100, "buy");
    assert.equal(quote(a, MINT, "buy", qty, 100).refusal, null, `max buy refused at $${balance}`);
  }
});

test("the quote and the execution agree on the price and the fee", () => {
  const a = openAccount(10_000);
  const q = quote(a, MINT, "buy", 10, 100);
  const { fill: f } = fill(a, "buy", 10, 100);
  assert.equal(q.price, f.price);
  assert.equal(q.feeUsd, f.feeUsd);
});

test("a rounding crumb left by a sell counts as flat, and its cost is booked", () => {
  /*
   * Selling in USD rounds to the cent and converts back to a quantity, so a
   * "sell everything" lands a few millionths of a SOL short. That remainder
   * is above DUST, so without the crumb sweep the position never goes flat:
   * the cost basis never resets, the card shows an open position worth two
   * hundredths of a cent, and it can never be closed because the fee to sell
   * it is $0.95.
   */
  const a = openAccount(10_000);
  const { account: b } = fill(a, "buy", 10, 100);

  // Sell all but 2.2e-6 SOL — the size of remainder a cent-rounded Max leaves.
  const { account: c } = fill(b, "sell", 10 - 2.2e-6, 100);

  assert.equal(sol(c), 0, "a crumb is not a position");
  assert.equal(basis(c), 0, "and it must not anchor the next position");

  // The crumb was paid for and cannot be recovered, so it is a realised loss,
  // not a rounding error that quietly vanishes from the books.
  assert.ok(Math.abs(c.usdc - (a.usdc + c.realisedUsd)) < 1e-9, "the books still balance");
});

test("a real small position is not swept", () => {
  const a = openAccount(10_000);
  const { account: b } = fill(a, "buy", 10, 100);
  const { account: c } = fill(b, "sell", 9.99, 100);

  // 0.01 SOL is a dollar at this price — far above a crumb, and still theirs.
  assert.ok(sol(c) > 0, "a dollar of SOL is a position");
  assert.ok(basis(c) > 0);
});

test("selling the exact position leaves nothing behind", () => {
  const a = openAccount(10_000);
  const { account: b } = fill(a, "buy", 7.3, 141.77);
  const { account: c } = fill(b, "sell", sol(b), 141.77);
  assert.equal(sol(c), 0);
  assert.equal(basis(c), 0);
});

test("the all-in price accounts for every dollar that moved", () => {
  /*
   * The UI itemises no fees, so the price it shows has to carry them. If
   * size × price did not equal the cash that left the balance, the user would
   * see a gap they could not explain — worse than either showing the fee or
   * hiding it properly.
   */
  const a = openAccount(10_000);

  const qb = quote(a, MINT, "buy", 10, 100);
  assert.ok(Math.abs(10 * allInPrice(qb) - qb.cashUsd) < 1e-9, "a buy reconciles");
  assert.ok(allInPrice(qb) > qb.price, "the buyer pays above the fill");

  const { account: b } = fill(a, "buy", 10, 100);
  const qs = quote(b, MINT, "sell", 10, 100);
  assert.ok(Math.abs(10 * allInPrice(qs) - qs.cashUsd) < 1e-9, "a sell reconciles");
  assert.ok(allInPrice(qs) < qs.price, "the seller receives below the fill");

  // A fill has the same four fields, so the history reconciles the same way.
  const { fill: f } = fill(a, "buy", 10, 100);
  assert.equal(allInPrice(f), allInPrice(qb));
});

/*
 * PRICE IMPACT AND SLIPPAGE TOLERANCE
 *
 * These cannot be exercised through the UI at a $10,000 paper balance: that
 * order against SOL's multi-million-dollar book moves the price by about a
 * seventh of one percent, so the tolerance never binds. It binds on a thin
 * memecoin pool, which is the case that actually matters and the one nobody
 * can click their way to. Hence tests.
 */

test("depth is optional, and without it nothing changes", () => {
  const a = openAccount(10_000);
  assert.equal(quote(a, MINT, "buy", 10, 100).impactBps, 0);
  assert.equal(quote(a, MINT, "buy", 10, 100).price, quote(a, MINT, "buy", 10, 100, {}).price);
});

test("impact scales with size against the book", () => {
  const a = openAccount(1_000_000);
  // $1,000 into a $1,000,000 book is a tenth of a percent.
  const small = quote(a, MINT, "buy", 10, 100, { depthUsd: 1_000_000 });
  assert.ok(Math.abs(small.impactBps - 10) < 1e-9);

  // Ten times the size, ten times the impact.
  const big = quote(a, MINT, "buy", 100, 100, { depthUsd: 1_000_000 });
  assert.ok(Math.abs(big.impactBps - 100) < 1e-9);

  assert.ok(big.price > small.price, "a bigger buy fills worse");
});

test("a thin pool refuses an order that breaches tolerance", () => {
  const a = openAccount(100_000);
  // $5,000 into a $40,000 pool is 12.5%, well past a 3% tolerance.
  const q = quote(a, MINT, "buy", 50, 100, { depthUsd: 40_000, slippageBps: 300 });
  assert.ok(q.refusal);
  assert.match(q.refusal!, /12\.50%.*3\.00%/);
});

/*
 * Tolerance is checked BEFORE affordability. A trade that breaches slippage
 * does not happen, so "you cannot afford it" answers a question that no longer
 * applies — and it sends the user to top up a balance to fix a problem that is
 * really about order size against a thin book.
 */
test("the tolerance refusal wins over the affordability refusal", () => {
  const a = openAccount(100);
  const q = quote(a, MINT, "buy", 50, 100, { depthUsd: 40_000, slippageBps: 300 });
  assert.match(q.refusal!, /moves the price/);
});

test("the same order passes when the tolerance allows it", () => {
  const a = openAccount(100_000);
  const q = quote(a, MINT, "buy", 50, 100, { depthUsd: 40_000, slippageBps: 2_000 });
  assert.equal(q.refusal, null);
});

/* Past a third of the book this model stops describing anything real, so it
   is capped rather than printing slippage of several hundred percent. */
test("impact is capped at 50%", () => {
  const a = openAccount(10_000_000);
  const q = quote(a, MINT, "buy", 10_000, 100, { depthUsd: 1_000 });
  assert.equal(q.impactBps, 5_000);
});

/* ───────────────── a real quote replaces the model, and only the model ─── */

test("a quoted price is used exactly as given, not re-marked", () => {
  const a = openAccount(10_000);
  /* mark and quote deliberately disagree: the route is the truth, the mark is
     only what the screen happened to be showing when the button was pressed. */
  const q = quote(a, MINT, "buy", 1, 100, {
    quoted: { price: 103.5, impactBps: 7, route: "Orca" },
  });
  assert.equal(q.price, 103.5);
  assert.equal(q.impactBps, 7);
  assert.equal(q.route, "Orca");
});

test("the commission is charged ONCE on a quoted fill", () => {
  /*
   * THE BUG THIS EXISTS FOR. `quoteFill` used to ask Jupiter for the route
   * with `platformFeeBps: 50` baked in, and then this function ran `feeFor`
   * over the result — so a signed-in trade paid cipher twice. A $500 SOL buy
   * came out 1.04% above mid instead of 0.54%, and a position opened against a
   * $97.00 mark reported a cost basis of $97.92.
   *
   * It survived because the two paths disagreed silently: signed OUT prices
   * from the model and was right, signed IN priced from a quote and was not.
   * Nothing compared them, so nothing failed.
   */
  const a = openAccount(10_000);
  const price = 100;
  const qty = 5; // $500 of notional, comfortably over the $200 floor
  const q = quote(a, MINT, "buy", qty, price, {
    quoted: { price, impactBps: 0, route: "Orca" },
  });

  assert.equal(q.notionalUsd, 500);
  assert.equal(q.feeUsd, 2.5); // 0.50%, once
  assert.equal(q.cashUsd, 502.5);
});

test("a quoted fill and a modelled fill of the same price cost the same", () => {
  // The two paths are the same product. If they can disagree about what a
  // trade costs, one of them is lying to somebody.
  const a = openAccount(10_000);
  const modelled = quote(a, MINT, "buy", 4, 250, { depthUsd: null });
  const quoted = quote(a, MINT, "buy", 4, 250, {
    quoted: { price: modelled.price, impactBps: modelled.impactBps, route: "Orca" },
  });
  assert.equal(quoted.feeUsd, modelled.feeUsd);
  assert.equal(quoted.cashUsd, modelled.cashUsd);
});

test("a quoted fill pays the same flat 0.5%", () => {
  const a = openAccount(10_000);
  const q = quote(a, MINT, "buy", 1, 50, {
    quoted: { price: 50, impactBps: 0, route: "Orca" },
  });
  assert.equal(q.notionalUsd, 50);
  assert.equal(q.feeUsd, 0.25);
});

test("a $500 buy spends $500 in total, fee inside it", () => {
  const a = openAccount(10_000);
  const qty = resolveQty({ kind: "usd", value: 500 }, "buy", a, MINT, 100)!;
  const r = execute(a, { mint: MINT, side: "buy", qty, mark: 100, ts: 1 });
  assert.ok(!("refusal" in r));
  if (!("refusal" in r)) assert.ok(Math.abs(10_000 - r.account.usdc - 500) < 0.01);
});
