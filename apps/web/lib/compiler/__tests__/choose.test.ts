import { test } from "node:test";
import assert from "node:assert/strict";
import { INTENT_VERSION, ORDER_SPEC_VERSION, type Compiled, type OrderSpec } from "@cipher/shared";
import { choose, needsModel } from "../choose.ts";
import { validateOrder } from "../validate.ts";
import { ordersOnly } from "../llm.ts";

const spec = (over: Partial<OrderSpec> = {}): OrderSpec => ({
  version: ORDER_SPEC_VERSION,
  entry: {
    side: "buy",
    token: "sol",
    mint: "SOL",
    amount: { kind: "usd", value: 50 },
    slippageBps: 300,
    privateSubmission: true,
    priority: "normal",
    tipSol: null,
    trigger: null,
  },
  exits: [],
  source: "grammar",
  warnings: [],
  ...over,
});

const order = (s: OrderSpec, warnings: string[] = []): Compiled => ({
  version: INTENT_VERSION,
  intent: { kind: "order", spec: s },
  source: "grammar",
  warnings,
});
const refusal = (reason: "outOfScope" | "notUnderstood"): Compiled => ({
  version: INTENT_VERSION,
  intent: { kind: "refusal", reason, message: "no" },
  source: "grammar",
  warnings: [],
});

/* ─────────────────────────── who reads what ──────────────────────────── */

test("orders and unreadable sentences go to the model; the rest never cost a call", () => {
  assert.equal(needsModel(order(spec())), true);
  assert.equal(needsModel(refusal("notUnderstood")), true);
  // "should I buy SOL" was refused as out of scope: a decision, not a failure.
  assert.equal(needsModel(refusal("outOfScope")), false);
  assert.equal(
    needsModel({ version: INTENT_VERSION, intent: { kind: "query", subject: "pnl" }, source: "grammar", warnings: [] }),
    false,
  );
});

test("the model's order wins over the grammar's", () => {
  const modelOrder = order(spec({ exits: [{ id: "x", trigger: { kind: "priceAbsolute", value: 120 }, amount: { kind: "percentOfPosition", value: 100 } }] }));
  assert.equal(choose(order(spec()), modelOrder), modelOrder);
});

test("with no model answer, the grammar answers — the bar never stops working", () => {
  const g = order(spec());
  assert.equal(choose(g, null), g);
});

test("a model refusal loses to a clean grammar order, and wins over a doubtful one", () => {
  const g = order(spec());
  assert.equal(choose(g, refusal("outOfScope")).intent.kind, "order");
  const doubtful = order(spec(), ["You asked for a stop and I didn't arm one."]);
  assert.equal(choose(doubtful, refusal("outOfScope")).intent.kind, "refusal");
});

/* ─────────────────── a misheard price never becomes an order ─────────── */

test("a price far from the market is asked about, not armed", () => {
  // Found live: "one twenty dollars" read as $21 with SOL at $112.
  const misheard = spec({
    exits: [{ id: "t", trigger: { kind: "priceAbsolute", value: 21 }, amount: { kind: "percentOfPosition", value: 100 } }],
  });
  const p = validateOrder(misheard, { cashUsd: 10_000, position: 0, price: 112 });
  assert.ok(p.some((x) => x.severity === "error" && /81% below/.test(x.message)));

  const fine = spec({
    exits: [{ id: "t", trigger: { kind: "priceAbsolute", value: 120 }, amount: { kind: "percentOfPosition", value: 100 } }],
  });
  assert.deepEqual(
    validateOrder(fine, { cashUsd: 10_000, position: 0, price: 112 }).filter((x) => x.severity === "error"),
    [],
  );
});

/* ─────────────────────────── the model's exit ids ────────────────────── */

test("the model's exit ids are replaced, so two orders never share one", () => {
  const fromModel = {
    intent: order(spec({ exits: [{ id: "exit1", trigger: { kind: "drawdownFromEntry", percent: 10 }, amount: { kind: "percentOfPosition", value: 100 } }] })).intent,
    warnings: [],
  };
  const a = ordersOnly(fromModel as never);
  const b = ordersOnly(fromModel as never);
  if (a.intent.kind !== "order" || b.intent.kind !== "order") throw new Error("not an order");
  assert.notEqual(a.intent.spec.exits[0].id, "exit1");
  assert.notEqual(a.intent.spec.exits[0].id, b.intent.spec.exits[0].id);
});

/* ─────────────── found in the live battery, 19 Sep 2026 ──────────────── */

import { repair } from "../llm.ts";
import { compiledSchema } from "../schema.ts";
import { compile } from "../compile.ts";

test("a correct model answer missing only bookkeeping is kept, not thrown away", () => {
  const groq = {
    intent: {
      kind: "order",
      spec: {
        version: 1,
        entry: { side: "buy", token: "sol", mint: null, amount: { kind: "usd", value: 50 }, slippageBps: 300, privateSubmission: true, priority: "normal", tipSol: null },
        exits: [
          { id: "e1", trigger: { kind: "drawdownFromEntry", percent: 10 }, amount: { kind: "percentOfPosition", value: 100 } },
          { id: "e2", trigger: { kind: "priceAbsolute", value: 120 } },
        ],
      },
    },
  };
  const out = compiledSchema.safeParse(repair(groq));
  assert.ok(out.success);
});

test("'buy for a hundred sol' is asked, never read as 100 SOL", () => {
  const out = compile("buy for a hundred sol", { symbol: "x", label: "SOL", interval: "1h", hasPosition: false });
  assert.equal(out.intent.kind, "clarify");
});

/* ─────────── every number said must be in the order (19 Sep 2026) ─────────── */

test("a model order that dropped the stop and target falls back to a complete grammar reading", () => {
  const said =
    "buy me fifty dollars of solana at the current market price and put a stop loss of negative ten percent and set a target price of one twenty dollars";
  const grammar = compile(said, { symbol: "x", label: "SOL", interval: "1h", hasPosition: false });
  const modelDroppedExits = order(spec()); // $50 buy, no exits — what Groq returned once
  const out = choose(grammar, modelDroppedExits, said);
  assert.equal(out.intent.kind, "order");
  if (out.intent.kind === "order") assert.equal(out.intent.spec.exits.length, 2);
});

test("a model order that dropped a limit price never executes at market", () => {
  const said = "sell 30% of my sol at $95";
  const grammar = compile(said, { symbol: "x", label: "SOL", interval: "1h", hasPosition: true });
  const atMarket = order(
    spec({ entry: { ...spec().entry!, side: "sell", amount: { kind: "percentOfPosition", value: 30 }, trigger: null } }),
  );
  const out = choose(grammar, atMarket, said);
  assert.equal(out.intent.kind, "order");
  if (out.intent.kind === "order") assert.deepEqual(out.intent.spec.entry?.trigger, { kind: "priceAbsolute", value: 95 });
});

test("when no reading has every number, nothing executes and the lost number is named", () => {
  const out = choose(order(spec()), order(spec()), "buy $50 of sol and set a target of $120");
  assert.equal(out.intent.kind, "refusal");
  if (out.intent.kind === "refusal") assert.match(out.intent.message, /\$120/);
});
