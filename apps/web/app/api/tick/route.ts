import { NextResponse } from "next/server";
import { allInPrice } from "@/lib/account/paper";
import { fireRule } from "@/lib/triggers/execute";
import { hasDb } from "@/lib/db/client";
import { loadAccount, saveFill } from "@/lib/db/accounts";
import {
  beat,
  childrenOf,
  claim,
  exitsOn,
  crossed,
  due,
  lapsed,
  newHighs,
  record,
  replace,
  setState,
  watchedMarkets,
} from "@/lib/db/rules";
import { fetchMajors } from "@/lib/market/markets";
import type { Rule, Transition } from "@cipher/shared";

/**
 * The worker. This is the whole point of the database.
 *
 * A rule armed in a browser used to be watched by that browser, which meant
 * closing the tab stopped the stop. This route is what watches instead: it
 * takes one price sample, finds every rule across every user that has crossed,
 * and fires them. Nobody has to be looking at anything.
 *
 * Called on a schedule — a cron every minute — so the rest of cipher can stay
 * serverless and free. That sets the resolution: a rule fires within a minute
 * of its price, not within a second.
 *
 * cipher: minute resolution is honest for majors and wrong for a launch, where
 * a minute is the whole move. The upgrade is a Cloudflare Durable Object
 * holding a live websocket and calling the same code on every tick — the
 * engine, the seam and these queries do not change, only what invokes them.
 * Doing that now would mean a second deployment target for a product with no
 * users.
 *
 * MAX_ATTEMPTS, exactly-once and every state transition live in the engine and
 * in `claim()`. This file is plumbing: fetch, match, execute, write.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** One tick may fire at most this many rules, so a bad minute cannot run long. */
const MAX_FIRES = 100;

function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  /*
   * No secret set means the endpoint is open, and an open endpoint that
   * executes trades is not something to ship by accident. Refusing is the
   * safe default; the schedule simply does not run until it is configured.
   */
  if (!secret) return false;
  const header = request.headers.get("authorization");
  return header === `Bearer ${secret}`;
}

export async function POST(request: Request) {
  return run(request);
}

/** Most cron services only send GET. Same work, same guard. */
export async function GET(request: Request) {
  return run(request);
}

async function run(request: Request) {
  if (!hasDb()) {
    return NextResponse.json({ error: "no database configured" }, { status: 503 });
  }
  if (!authorised(request)) {
    return NextResponse.json({ error: "not authorised" }, { status: 401 });
  }

  const now = Date.now();
  const fired: string[] = [];
  const errors: string[] = [];

  try {
    const markets = await watchedMarkets();

    /*
     * One price fetch for everyone.
     *
     * Not one per user and not one per rule. Ten thousand armed rules on SOL
     * are one request; the whole reason the index is keyed on market is that
     * price is a property of the market, not of the person watching it.
     */
    const majors = markets.length > 0 ? await fetchMajors() : [];
    const priceOf = new Map(majors.map((m) => [m.id, m.priceUsd]));

    for (const market of markets) {
      const price = priceOf.get(market);
      if (price === undefined) continue;

      /*
       * Highs before crossings, as in the in-memory engine.
       *
       * A new high moves a trailing stop's threshold UP. Checking crossings
       * first would fire the stop on the very tick that set the new high — a
       * stop triggered by the price going the right way.
       */
      for (const { rule } of await newHighs(market, price)) {
        await replace({ ...rule, highWater: price });
      }

      for (const { rule, userId } of await crossed(market, price)) {
        if (fired.length >= MAX_FIRES) break;
        const done = await fire(rule, userId, price, now);
        if (done) fired.push(rule.id);
      }
    }

    /*
     * Deadlines, on the clock rather than on a trade.
     *
     * Time-based exits are the gap-proof ones: a market that gaps straight
     * through a stop still passes through every second on the way. A rule
     * whose only trigger is a deadline must not wait for a price to print.
     */
    for (const { rule, userId } of await due(now)) {
      if (fired.length >= MAX_FIRES) break;
      const price = priceOf.get(rule.market) ?? (await priceFor(rule.market));
      if (price === null) continue;
      const done = await fire(rule, userId, price, now);
      if (done) fired.push(rule.id);
    }

    /*
     * Expiry LAST, after firing.
     *
     * A rule whose deadline and whose authority lapse in the same tick should
     * fire: the instruction was due, and the permission was still valid when
     * it became due. The other order silently drops an order that was owed.
     */
    const expired: string[] = [];
    for (const { rule, userId } of await lapsed(now)) {
      await setState(rule.id, "expired");
      await record(userId, [
        {
          ruleId: rule.id,
          from: rule.state,
          to: "expired",
          at: now,
          reason: "authority expired before it fired",
        },
      ]);
      expired.push(rule.id);
    }

    await beat(`${markets.length} markets, ${fired.length} fired`);
    return NextResponse.json({ ok: true, markets: markets.length, fired, expired, errors });
  } catch (e) {
    console.error("[cipher] tick failed:", e);
    return NextResponse.json({ error: "tick failed" }, { status: 500 });
  }
}

async function priceFor(market: string): Promise<number | null> {
  const majors = await fetchMajors();
  return majors.find((m) => m.id === market)?.priceUsd ?? null;
}

/**
 * Fire one rule: claim it, execute it, write what happened.
 *
 * Claiming first is the whole of exactly-once. Two workers overlapping, or a
 * worker and an open browser tab, can both see the same crossing in the same
 * second — and only the one whose UPDATE changed a row is allowed to trade.
 */
async function fire(
  rule: Rule,
  userId: string,
  price: number,
  now: number,
): Promise<boolean> {
  if (!(await claim(rule.id))) return false;

  const transitions: Transition[] = [
    { ruleId: rule.id, from: "armed", to: "firing", at: now, reason: "price crossed", price },
  ];

  const account = await loadAccount(userId, false);
  if (!account) {
    await setState(rule.id, "failed");
    transitions.push({
      ruleId: rule.id,
      from: "firing",
      to: "failed",
      at: now,
      reason: "no account",
    });
    await record(userId, transitions);
    return false;
  }

  const outcome = fireRule(account, rule, { mark: price, ts: Math.floor(now / 1000) });

  if (outcome.kind === "filled") {
    await saveFill(userId, outcome.account, outcome.fill);
    await setState(rule.id, "filled");
    transitions.push({
      ruleId: rule.id,
      from: "firing",
      to: "filled",
      at: now,
      reason: "executed",
      price: allInPrice(outcome.fill),
    });

    /*
     * A SELL THAT EMPTIED THE POSITION kills every other exit on it.
     *
     * They all measure from an entry that no longer exists, and the damage
     * lands on the re-entry: a stop at $71 from a $102 entry, still armed,
     * sells a position bought back at $60 on the next tick. The browser does
     * the same thing when it owns the rules; this is the half that runs while
     * nobody is looking.
     */
    if (rule.side === "sell" && outcome.account.sol <= 0) {
      for (const { rule: stale } of await exitsOn(rule.market, userId)) {
        if (stale.id === rule.id) continue;
        await setState(stale.id, "cancelled");
        transitions.push({
          ruleId: stale.id,
          from: stale.state,
          to: "cancelled",
          at: now,
          reason: "position closed",
        });
      }
    }

    /*
     * A resting BUY that just filled is an entry, and the exits armed
     * alongside it have been waiting for exactly this price. Only its own
     * children — matching on market alone let the first entry to fill bind
     * every waiting exit, including another order's.
     */
    if (rule.side === "buy") {
      const paid = allInPrice(outcome.fill);
      for (const { rule: child } of await childrenOf(rule.id)) {
        await replace({ ...child, entryPrice: paid, highWater: paid, state: "armed" });
        transitions.push({
          ruleId: child.id,
          from: "unbound",
          to: "armed",
          at: now,
          reason: `bound to entry at ${paid}`,
          price: paid,
        });
      }
    }
  } else if (outcome.kind === "moot") {
    await setState(rule.id, "cancelled");
    transitions.push({
      ruleId: rule.id,
      from: "firing",
      to: "cancelled",
      at: now,
      reason: outcome.reason,
    });
  } else {
    const attempts = rule.attempts + 1;
    const giveUp = attempts >= 3;
    await setState(rule.id, giveUp ? "failed" : "armed", { attempts });
    transitions.push({
      ruleId: rule.id,
      from: "firing",
      to: giveUp ? "failed" : "armed",
      at: now,
      reason: giveUp ? `gave up after ${attempts}: ${outcome.reason}` : `retry ${attempts}: ${outcome.reason}`,
    });
  }

  await record(userId, transitions);
  return outcome.kind === "filled";
}
