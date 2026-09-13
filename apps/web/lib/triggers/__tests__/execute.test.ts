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
  // A limit sell at $250 is deliberately absent here: at a mark of 200 it
  // refuses to fill, which is the whole point of a limit. Covered below.
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

/* ───────────────────── the other half of a limit order ─────────────────── */

test("a limit sell will not fill below its limit", () => {
  const account = holding(10);
  const rule = ruleFor({ kind: "priceAbsolute", value: 250 });

  /*
   * A trigger on its own is a DELAYED MARKET ORDER. The rule fires on the
   * crossing and then takes whatever the spread gives — which is how a "limit
   * sell at $101.75" filled at $100.70 in testing, a dollar below the number
   * on the card. On chain the swap's minimumOutAmount makes the program itself
   * refuse; here the ledger does.
   */
  const out = fireRule(account, rule, { mark: 200, ts: TS });
  assert.equal(out.kind, "failed");
  if (out.kind !== "failed") return;
  assert.match(out.reason, /below your limit/);
});

test("a limit sell fills at or above its limit", () => {
  const account = holding(10);
  const out = fireRule(account, ruleFor({ kind: "priceAbsolute", value: 250 }), {
    mark: 300,
    ts: TS,
  });
  assert.equal(out.kind, "filled");
  if (out.kind !== "filled") return;
  assert.ok(out.fill.price >= 250, `filled at ${out.fill.price}`);
});

test("a limit buy will not fill above its limit", () => {
  const s = emptyEngine();
  arm(s, {
    rule: { id: "b1", trigger: { kind: "priceAbsolute", value: 95 }, amount: { kind: "usd", value: 500 } },
    market: MKT,
    at: T0,
    side: "buy",
    entryPrice: 101,
  });

  const out = fireRule(openAccount(10_000), s.rules.b1, { mark: 100, ts: TS });
  assert.equal(out.kind, "failed");
  if (out.kind !== "failed") return;
  assert.match(out.reason, /above your limit/);
});

test("failing the limit retries rather than giving up", () => {
  // Exactly what a resting order on a real book does while the price is on the
  // wrong side: nothing, until it is not. `moot` would cancel it instead.
  const account = holding(10);
  const out = fireRule(account, ruleFor({ kind: "priceAbsolute", value: 250 }), {
    mark: 200,
    ts: TS,
  });
  assert.notEqual(out.kind, "moot");
});

test("a STOP still fills at the market, however far it has fallen", () => {
  /*
   * The exclusion is as important as the rule. "-50%" means get me out, and a
   * stop that refuses because the price kept falling is a stop that does not
   * work in exactly the crash it exists for. Real venues draw the same line:
   * stop-market versus stop-limit.
   */
  const account = holding(10);
  const out = fireRule(account, ruleFor({ kind: "drawdownFromEntry", percent: 50 }), {
    mark: 20,
    ts: TS,
  });
  assert.equal(out.kind, "filled");
});

test("a trailing stop is a market order too", () => {
  const account = holding(10);
  const out = fireRule(account, ruleFor({ kind: "trailingStop", percent: 20 }), {
    mark: 10,
    ts: TS,
  });
  assert.equal(out.kind, "filled");
});
