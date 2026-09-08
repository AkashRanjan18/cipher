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
  type Account,
} from "../paper.ts";

/** Helper: execute and fail the test loudly if the order was refused. */
function fill(a: Account, side: "buy" | "sell", qty: number, mark: number, ts = 1_700_000_000) {
  const r = execute(a, { side, qty, mark, ts });
  if ("refusal" in r) throw new Error(`refused: ${r.refusal}`);
  return r;
}

test("the deposit is the whole account until something happens", () => {
  const a = openAccount(10_000);
  assert.equal(a.usdc, 10_000);
  assert.equal(a.sol, 0);
  assert.equal(equity(a, 103), 10_000);
  assert.equal(unrealised(a, 103), 0);
});

test("the commission floor bites below $200 and the rate takes over above it", () => {
  assert.equal(feeFor(20), 0.95); // 4.75% — small orders are genuinely expensive
  assert.equal(feeFor(199), 0.95);
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
  assert.equal(b.sol, 10);
  assert.equal(b.costBasis, (notional + fee) / 10);
  assert.equal(b.feesUsd, fee);

  /*
   * The point of folding the fee in: a position opened at the current price
   * is DOWN, not flat. A screen that showed $0.00 here would be claiming
   * break-even at a price where selling loses money.
   */
  assert.ok(unrealised(b, 100) < 0);
});

test("a partial sale books its share of the basis and leaves the rest priced the same", () => {
  const a = openAccount(10_000);
  const { account: b } = fill(a, "buy", 10, 100);
  const basis = b.costBasis;

  const { account: c, fill: f } = fill(b, "sell", 4, 200);

  assert.equal(c.sol, 6);
  assert.equal(c.costBasis, basis, "the remaining position keeps its per-unit cost");
  assert.ok(f.realisedUsd > 0);
  assert.equal(c.realisedUsd, f.realisedUsd);

  // Realised is proceeds after fee, minus what those 4 SOL cost to acquire.
  const px = fillPrice(200, "sell");
  const proceeds = 4 * px - feeFor(4 * px);
  assert.equal(f.realisedUsd, proceeds - 4 * basis);
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

  assert.equal(c.sol, 0);
  assert.equal(c.costBasis, 0);

  const { account: d } = fill(c, "buy", 1, 200);
  assert.ok(Math.abs(d.costBasis - 200) < 5, "reopened at 200, not anchored to 100");
});

test("a round trip nets out to realised P&L minus every fee charged", () => {
  const a = openAccount(10_000);
  const { account: b } = fill(a, "buy", 10, 100);
  const { account: c } = fill(b, "sell", 10, 120);

  assert.equal(c.sol, 0);
  // Flat, so equity is pure cash and cash is the deposit plus what was made.
  assert.ok(Math.abs(equity(c, 120) - (10_000 + c.realisedUsd)) < 1e-9);
  // And the profit is smaller than the naive 20% by the spread and both fees.
  assert.ok(c.realisedUsd < 200);
  assert.ok(c.realisedUsd > 180);
});

test("it refuses rather than overdrawing", () => {
  const a = openAccount(100);
  const r = execute(a, { side: "buy", qty: 10, mark: 100, ts: 1 });
  assert.ok("refusal" in r);
  assert.deepEqual(a, openAccount(100), "a refused order changes nothing");
});

test("it refuses rather than short-selling", () => {
  const a = openAccount(10_000);
  const { account: b } = fill(a, "buy", 1, 100);
  const r = execute(b, { side: "sell", qty: 5, mark: 100, ts: 1 });
  assert.ok("refusal" in r);
  assert.match((r as { refusal: string }).refusal, /you hold/i);
});

test("it refuses a sale worth less than its own fee", () => {
  const a = openAccount(10_000);
  const { account: b } = fill(a, "buy", 10, 100);
  const r = execute(b, { side: "sell", qty: 0.001, mark: 100, ts: 1 });
  assert.ok("refusal" in r, "0.1 dollars of SOL costs $0.95 to sell");
});

test("percentOfPosition only means something on a sell", () => {
  const a = openAccount(10_000);
  const { account: b } = fill(a, "buy", 10, 100);

  assert.equal(resolveQty({ kind: "percentOfPosition", value: 33 }, "sell", b, 100), 3.3);
  assert.equal(
    resolveQty({ kind: "percentOfPosition", value: 33 }, "buy", b, 100),
    null,
    "buying a third of your position is a misparse, not an order",
  );
});

test("a usd amount resolves through the fill price, not the mark", () => {
  const a = openAccount(10_000);
  const qty = resolveQty({ kind: "usd", value: 1_000 }, "buy", a, 100)!;
  assert.equal(qty, 1_000 / fillPrice(100, "buy"));
  assert.ok(qty < 10, "you get less than the chart price implies, because you do");
});

test("max buy is the largest order that is not refused", () => {
  for (const balance of [10_000, 500, 201, 150, 20, 1, 0.5]) {
    const a = openAccount(balance);
    const usd = maxBuyUsd(a);
    if (usd <= 0) continue;
    const qty = usd / fillPrice(100, "buy");
    assert.equal(quote(a, "buy", qty, 100).refusal, null, `max buy refused at $${balance}`);
  }
});

test("the quote and the execution agree on the price and the fee", () => {
  const a = openAccount(10_000);
  const q = quote(a, "buy", 10, 100);
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

  assert.equal(c.sol, 0, "a crumb is not a position");
  assert.equal(c.costBasis, 0, "and it must not anchor the next position");

  // The crumb was paid for and cannot be recovered, so it is a realised loss,
  // not a rounding error that quietly vanishes from the books.
  assert.ok(Math.abs(c.usdc - (a.usdc + c.realisedUsd)) < 1e-9, "the books still balance");
});

test("a real small position is not swept", () => {
  const a = openAccount(10_000);
  const { account: b } = fill(a, "buy", 10, 100);
  const { account: c } = fill(b, "sell", 9.99, 100);

  // 0.01 SOL is a dollar at this price — far above a crumb, and still theirs.
  assert.ok(c.sol > 0, "a dollar of SOL is a position");
  assert.ok(c.costBasis > 0);
});

test("selling the exact position leaves nothing behind", () => {
  const a = openAccount(10_000);
  const { account: b } = fill(a, "buy", 7.3, 141.77);
  const { account: c } = fill(b, "sell", b.sol, 141.77);
  assert.equal(c.sol, 0);
  assert.equal(c.costBasis, 0);
});

test("the all-in price accounts for every dollar that moved", () => {
  /*
   * The UI itemises no fees, so the price it shows has to carry them. If
   * size × price did not equal the cash that left the balance, the user would
   * see a gap they could not explain — worse than either showing the fee or
   * hiding it properly.
   */
  const a = openAccount(10_000);

  const qb = quote(a, "buy", 10, 100);
  assert.ok(Math.abs(10 * allInPrice(qb) - qb.cashUsd) < 1e-9, "a buy reconciles");
  assert.ok(allInPrice(qb) > qb.price, "the buyer pays above the fill");

  const { account: b } = fill(a, "buy", 10, 100);
  const qs = quote(b, "sell", 10, 100);
  assert.ok(Math.abs(10 * allInPrice(qs) - qs.cashUsd) < 1e-9, "a sell reconciles");
  assert.ok(allInPrice(qs) < qs.price, "the seller receives below the fill");

  // A fill has the same four fields, so the history reconciles the same way.
  const { fill: f } = fill(a, "buy", 10, 100);
  assert.equal(allInPrice(f), allInPrice(qb));
});
