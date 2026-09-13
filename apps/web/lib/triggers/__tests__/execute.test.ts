import { test } from "node:test";
import assert from "node:assert/strict";
import { arm, emptyEngine, type Rule } from "@cipher/shared";
import { openAccount, execute, type Account } from "../../account/paper.ts";
import { fireRule } from "../execute.ts";

const T0 = 1_700_000_000_000;
const TS = 1_700_000_000; // seconds — what paper.ts stores on a fill
const MKT = "SOLUSDT";

/** An armed, bound rule, built through the engine so the shapes stay honest. */
function ruleFor(
  trigger: Rule["trigger"],
  amount: Rule["amount"] = { kind: "percentOfPosition", value: 100 },
): Rule {
  const s = emptyEngine();
  arm(s, {
    rule: { id: "r1", trigger, amount },
    market: MKT,
    at: T0,
    entryPrice: 100,
  });
  return s.rules.r1;
}

/** An account already holding SOL, bought at `price`. */
function holding(qty: number, price = 100): Account {
  const r = execute(openAccount(10_000), { side: "buy", qty, mark: price, ts: TS });
  if ("refusal" in r) throw new Error(r.refusal);
  return r.account;
}

test("a take-profit sells the whole position and books the fill as Sana's", () => {
  const account = holding(10);
  const out = fireRule(account, ruleFor({ kind: "priceMultiple", value: 2 }), {
    mark: 200,
    ts: TS,
  });

  assert.equal(out.kind, "filled");
  if (out.kind !== "filled") return;
  assert.equal(out.account.sol, 0);
  assert.equal(out.fill.source, "sana");
  assert.equal(out.fill.squawk, "take profit at 2x");
  assert.ok(out.account.realisedUsd > 0);
});

test("a percentage is of the position at fire time, not at arm time", () => {
  // Armed against 10 SOL, but the user bought more before it fired.
  const rule = ruleFor({ kind: "priceMultiple", value: 2 }, { kind: "percentOfPosition", value: 50 });
  const account = holding(30);

  const out = fireRule(account, rule, { mark: 200, ts: TS });
  assert.equal(out.kind, "filled");
  if (out.kind !== "filled") return;
  // Half of thirty, not half of ten.
  assert.equal(out.account.sol, 15);
});

test("a stop on a position that was already closed by hand is moot, not failed", () => {
  const out = fireRule(openAccount(10_000), ruleFor({ kind: "drawdownFromEntry", percent: 50 }), {
    mark: 50,
    ts: TS,
  });

  // The distinction is the point: `failed` would retry three times and then
  // tell the user their stop failed, for a trade that was never owed.
  assert.equal(out.kind, "moot");
});

test("dust is moot — it would cost a dollar to sell fifty cents", () => {
  const account = holding(0.001); // about ten cents at 100
  const out = fireRule(account, ruleFor({ kind: "priceMultiple", value: 2 }), {
    mark: 100,
    ts: TS,
  });

  assert.equal(out.kind, "moot");
});

test("a rung asking for slightly more than is held clamps instead of refusing", () => {
  const account = holding(10);
  // 100.5% of the position — the shape rounding across a ladder produces.
  const rule = ruleFor(
    { kind: "priceMultiple", value: 2 },
    { kind: "percentOfPosition", value: 100.5 },
  );

  const out = fireRule(account, rule, { mark: 200, ts: TS });
  assert.equal(out.kind, "filled");
  if (out.kind !== "filled") return;
  assert.equal(out.account.sol, 0);
});

test("a fill the tolerance refuses comes back as failed, so it retries", () => {
  const account = holding(10);
  const out = fireRule(account, ruleFor({ kind: "priceMultiple", value: 2 }), {
    mark: 200,
    ts: TS,
    // A thin book and a tight tolerance: this fill moves the price too far.
    depthUsd: 5_000,
    slippageBps: 1,
  });

  assert.equal(out.kind, "failed");
  if (out.kind !== "failed") return;
  assert.ok(out.reason.length > 0);
});

test("each trigger kind reads back as the instruction the user gave", () => {
  const account = holding(10);
  const squawk = (t: Rule["trigger"]) => {
    const out = fireRule(account, ruleFor(t), { mark: 200, ts: TS });
    return out.kind === "filled" ? out.fill.squawk : null;
  };

  assert.equal(squawk({ kind: "priceMultiple", value: 3 }), "take profit at 3x");
  assert.equal(squawk({ kind: "drawdownFromEntry", percent: 50 }), "stop at -50%");
  assert.equal(squawk({ kind: "trailingStop", percent: 20 }), "trailing stop, 20% off the high");
  assert.equal(squawk({ kind: "priceAbsolute", value: 250 }), "limit at $250");
  assert.equal(squawk({ kind: "duration", seconds: 60 }), "timed exit");
});

test("the fee is charged exactly as a hand-placed sell would be", () => {
  const account = holding(10);
  const byHand = execute(account, { side: "sell", qty: 10, mark: 200, ts: TS });
  const byRule = fireRule(account, ruleFor({ kind: "priceMultiple", value: 2 }), {
    mark: 200,
    ts: TS,
  });

  assert.ok(!("refusal" in byHand));
  assert.equal(byRule.kind, "filled");
  if ("refusal" in byHand || byRule.kind !== "filled") return;
  // One ledger, one fee schedule. A trigger is not a different kind of trade.
  assert.equal(byRule.fill.feeUsd, byHand.fill.feeUsd);
  assert.equal(byRule.account.usdc, byHand.account.usdc);
});
