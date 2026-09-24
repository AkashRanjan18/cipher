import { test } from "node:test";
import assert from "node:assert/strict";
import type { CompileContext, OrderSpec } from "@cipher/shared";
import { compile } from "../compile.ts";
import { choose } from "../choose.ts";

/*
 * The user's own list of how traders talk, 24 Sep 2026, run through the path
 * production takes when the model is unavailable: compile, then choose() with
 * no model — which refuses any order that lost a number the person said.
 * Before rephrase.ts, 4 of these 30 executed.
 */

const flat: CompileContext = { symbol: "SOL", label: "SOL", interval: "1h", hasPosition: false, price: 150 };
const held: CompileContext = { ...flat, hasPosition: true };

function read(s: string, ctx = flat) {
  return choose(compile(s, ctx), null, s).intent;
}
function spec(s: string, ctx = flat): OrderSpec {
  const i = read(s, ctx);
  assert.equal(i.kind, "order", `${s} → ${JSON.stringify(i).slice(0, 200)}`);
  return (i as { spec: OrderSpec }).spec;
}

test("slang and urgency still mean a market order of the size said", () => {
  for (const [s, usd] of [
    ["Ape $500 into SOL at market price immediately.", 500],
    ["Grab me a bag of SOL worth 50 bucks right now.", 50],
    ["Full send on Solana, market buy with 200 dollars.", 200],
    ["Get me into SOL right this second, use 1K cash.", 1000],
    ["Panic buy SOL for $300, let's ride.", 300],
    ["Chop up $50 and market buy SOL.", 50],
    ["Instant fill $150 worth of Solana, don't wait.", 150],
  ] as const) {
    const e = spec(s).entry!;
    assert.equal(e.side, "buy", s);
    assert.deepEqual(e.amount, { kind: "usd", value: usd }, s);
    assert.equal(e.trigger, null, s);
  }
});

test("closing the whole position, said three ways", () => {
  for (const s of [
    "Yo dump this shit right now, market sell all my Solana.",
    "Sell my entire SOL bag at market, get me out.",
    "Nuke my position, market sell everything on Solana.",
  ]) {
    const e = spec(s, held).entry!;
    assert.equal(e.side, "sell", s);
    assert.deepEqual(e.amount, { kind: "percentOfPosition", value: 100 }, s);
  }
});

test("a drop from here rests the buy at the price it implies, and says so", () => {
  for (const [s, at] of [
    ["Catch the knife on SOL: limit buy $200 worth if it falls 8% lower.", 138],
    ["Wait for SOL to pull back 5%, then pick up $500 of it with a 15% profit target.", 142.5],
    ["Buy $300 of SOL if it retraces 12%, target 20% higher.", 132],
    ["Set a limit order for SOL down 15% from here, size is $400.", 127.5],
    ["Pick up some Solana tokens worth $75 if it dumps another 5%.", 142.5],
    ["Look for a 10% drop on SOL, then ape $100 into it.", 135],
    ["Limit order SOL: buy $500 when price slides down 6%.", 141],
  ] as const) {
    const o = spec(s);
    assert.deepEqual(o.entry!.trigger, { kind: "priceAbsolute", value: at }, s);
    assert.ok(o.conversions?.some((c) => /below \$150/.test(c.note)), s);
  }
});

test("a price condition before the verb is the buy's price", () => {
  const o = spec("If Solana dips to 135, grab $1000 worth, stop loss at 125.");
  assert.deepEqual(o.entry!.amount, { kind: "usd", value: 1000 });
  assert.deepEqual(o.entry!.trigger, { kind: "priceAbsolute", value: 135 });
  assert.deepEqual(o.exits[0].trigger, { kind: "priceAbsolute", value: 125 });
});

test("gains and losses said as rungs become sized targets and stops", () => {
  const a = spec("Buy $1,000 of SOL. Sell 40% at a 20% gain, and dump the remaining 60% if it breaks below entry by 8%.");
  assert.ok(a.exits.some((x) => x.trigger.kind === "priceMultiple" && x.trigger.value === 1.2 && x.amount.value === 40));
  assert.ok(a.exits.some((x) => x.trigger.kind === "drawdownFromEntry" && x.trigger.percent === 8 && x.amount.value === 60));

  const b = spec("Grab $300 of SOL at market. Sell 50% at +10%, another 25% at +20%, and cut the rest if it drops 5%.");
  assert.deepEqual(
    b.exits.map((x) => [x.trigger.kind, x.amount.value]).sort(),
    [["drawdownFromEntry", 25], ["priceMultiple", 25], ["priceMultiple", 50]],
  );

  const c = spec("Split my exit: buy $150 of SOL, sell 50% at 8% profit and the other half at 15% profit.");
  assert.equal(c.exits.length, 2);

  const d = spec("Buy me $100 of Solana at the current price, and sell 70% of it when it drops by 10%. Then sell 50% when it hits 10% more than the current price.");
  assert.equal(d.entry!.trigger, null);
  assert.equal(d.exits.length, 2);
});

test("a missing number is asked for, never invented", () => {
  for (const [s, about] of [
    ["Okay, buy me Solana when it drops 10%, and then set a stop loss of 10% and a target of 50%.", /how much/i],
    ["Enter $500 on SOL. Take half off the table at +15%, and let the rest run with a trailing stop.", /trailing stop/i],
    ["Open a $200 position on Solana. Sell 30% if it goes down 5% as a stop, and scale out chunks at +10% and +25%.", /each level/i],
    ["DCA style entry: buy $200 SOL now, sell 80% at 12% upside, keep 20% for a moonbag with a break-even stop.", /stop/i],
    ["Long $400 of Solana, set a target for 30% up, but scale out a quarter of it every 10% rise.", /fixed levels/i],
  ] as const) {
    const i = read(s);
    assert.equal(i.kind, "clarify", s);
    if (i.kind === "clarify") assert.match(i.question, about, s);
  }
  /* The drop survives the size question: the answer rests at $135. */
  const q = read("Okay, buy me Solana when it drops 10%, and then set a stop loss of 10% and a target of 50%.");
  if (q.kind === "clarify") assert.match(q.fill!.template, /at \$135/);
});

test("a price is never spent as the size", () => {
  const i = read("buy solana at $95");
  assert.equal(i.kind, "clarify");
});
