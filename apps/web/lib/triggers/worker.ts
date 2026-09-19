import { allInPrice, positionOf } from "../account/paper.ts";
import { fireRule, freezeAmount, plan } from "./execute.ts";
import { quoteFill, type QuotedFill } from "../chain/fill.ts";
import { QuoteError } from "../chain/jupiter.ts";
import { DEFAULTS } from "@cipher/shared";
import { loadAccount, saveFill } from "../db/accounts.ts";
import {
  beat,
  childrenOf,
  claim,
  crossed,
  due,
  exitsOn,
  lapsed,
  newHighs,
  record,
  replace,
  setState,
  watchedMarkets,
} from "../db/rules.ts";
import { fetchPrices, isStale, newestBlock } from "../chain/prices.ts";
import { recordPrices } from "../db/prices.ts";
import type { Rule, Transition } from "@cipher/shared";

/**
 * One tick of the thing that watches while nobody is looking.
 *
 * IN lib/ RATHER THAN IN THE ROUTE, and the reason is not tidiness. This is the
 * only code in cipher that sells someone's position without a human present,
 * and while it lived in `app/api/tick/route.ts` it could not be tested at all:
 * a route file imports `next/server` and reaches its own dependencies through
 * the `@/` alias, neither of which the test runner resolves. The route is now
 * three lines of authorisation around this function, and this function runs
 * against a real Postgres in the suite.
 *
 * The state machine, exactly-once and MAX_ATTEMPTS are NOT here — they are in
 * the engine and in `claim()`. This is plumbing: fetch, match, execute, write.
 */

/** One tick may fire at most this many rules, so a bad minute cannot run long. */
const MAX_FIRES = 100;

/** How many failures before a rule is given up on. Mirrors the engine. */
const MAX_ATTEMPTS = 3;

export interface TickResult {
  markets: number;
  /** The newest Solana slot any price in this tick was derived at. */
  blockId: number;
  fired: string[];
  expired: string[];
  /** Markets deliberately not acted on: no price, or a feed that has stalled. */
  skipped: string[];
}

export async function tick(now: number = Date.now()): Promise<TickResult> {
  const fired: string[] = [];
  const expired: string[] = [];
  const skipped: string[] = [];

  const markets = await watchedMarkets();

  /*
   * PRICES COME FROM SOLANA, not from an exchange.
   *
   * This read Binance until recently, which meant a rule fired on the price of
   * SOL/USDT in a centralised order book and would have executed against a
   * Raydium pool — two different markets, with a basis between them that is
   * invisible to the user and unbounded during a move. For any memecoin there
   * is no Binance price at all.
   *
   * One fetch for everyone. Ten thousand armed rules across eleven markets are
   * eleven prices — price is a property of the market, not of the person
   * watching it, which is the whole reason the index is keyed on market.
   *
   * revalidate 0: the worker never reads a cached price. It runs once a minute
   * and it is the thing deciding whether to sell someone's position.
   */
  const priced = markets.length > 0 ? await fetchPrices(markets, { revalidate: 0 }) : new Map();
  const priceOf = new Map([...priced].map(([mint, p]) => [mint, p.usd]));
  /* Decimals come free with the price, and a quote cannot be built without
     them — base units are the only thing the chain understands. */
  const decimalsOf = new Map([...priced].map(([mint, p]) => [mint, p.decimals]));
  const head = newestBlock(priced);

  /* Best-effort: a price that cannot be written is still a price to act on,
     and a dead audit log must not stop a stop from firing. */
  if (priced.size > 0) {
    void recordPrices([...priced.values()]).catch((e: unknown) =>
      console.error("[cipher] price snapshot failed:", e),
    );
  }

  for (const market of markets) {
    const price = priceOf.get(market);
    if (price === undefined) {
      /*
       * No price means DO NOTHING, loudly.
       *
       * A market with armed rules and no price is a market nobody is watching,
       * and the silent version of that is the worst failure this file can have
       * — a stop that never fires because its price was never fetched reports
       * nothing at all.
       */
      skipped.push(market);
      continue;
    }

    /*
     * A STALE FEED IS NOT A FLAT MARKET, and acting on one is acting blind.
     * The block id is what separates them: the chain advanced, this price did
     * not. Refusing to fire is the conservative direction — a missed fire is
     * recoverable, a fire on a phantom price is not.
     */
    const p = priced.get(market);
    if (p && isStale(p, head)) {
      skipped.push(market);
      continue;
    }

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
      if (await fire(rule, userId, price, now, decimalsOf.get(market))) fired.push(rule.id);
    }
  }

  /*
   * Deadlines, on the clock rather than on a trade.
   *
   * Time-based exits are the gap-proof ones: a market that gaps straight
   * through a stop still passes through every second on the way. A rule whose
   * only trigger is a deadline must not wait for a price to print.
   */
  for (const { rule, userId } of await due(now)) {
    if (fired.length >= MAX_FIRES) break;
    const price = priceOf.get(rule.market) ?? (await priceFor(rule.market));
    if (price === null || price === undefined) continue;
    if (await fire(rule, userId, price, now, decimalsOf.get(rule.market))) fired.push(rule.id);
  }

  /*
   * Expiry LAST, after firing.
   *
   * A rule whose deadline and whose authority lapse in the same tick should
   * fire: the instruction was due, and the permission was still valid when it
   * became due. The other order silently drops an order that was owed.
   */
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

  /*
   * The heartbeat carries what was SKIPPED, because that is the number that
   * explains a rule which should have fired and did not.
   */
  await beat(
    `${markets.length} markets, ${fired.length} fired` +
      (skipped.length ? `, ${skipped.length} skipped (no price or stale)` : ""),
  );

  return { markets: markets.length, blockId: head, fired, expired, skipped };
}

/**
 * Record a failure that is worth retrying, and give up loudly on the third.
 *
 * Lifted out because the quote path and the execution path fail the same way
 * and must count against the same budget — a rule that cannot be priced three
 * times is as dead as one that cannot be executed three times, and two
 * separate counters would let it retry six.
 */
async function giveUp(
  rule: Rule,
  userId: string,
  now: number,
  transitions: Transition[],
  reason: string,
): Promise<void> {
  const attempts = rule.attempts + 1;
  const done = attempts >= MAX_ATTEMPTS;
  await setState(rule.id, done ? "failed" : "armed", { attempts });
  transitions.push({
    ruleId: rule.id,
    from: "firing",
    to: done ? "failed" : "armed",
    at: now,
    reason: done ? `gave up after ${attempts}: ${reason}` : `retry ${attempts}: ${reason}`,
  });
  await record(userId, transitions);
}

async function priceFor(market: string): Promise<number | null> {
  const one = await fetchPrices([market]);
  return one.get(market)?.usd ?? null;
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
  decimals: number | undefined,
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

  /*
   * QUOTED AGAINST A REAL ROUTE, not modelled.
   *
   * The ledger's spread-and-impact model is a fair approximation for SOL and
   * badly wrong for a thin pool — $500 into three thousand dollars of
   * liquidity moves the price several percent and the model charges ten basis
   * points. Since this function decides how much of someone's money moves
   * while they are asleep, it asks Jupiter what the trade would actually fill
   * at, through the same endpoint the real swap will use.
   *
   * `plan()` first, so the size being quoted is the size that will trade — and
   * so a rule that is already moot costs nothing to discover.
   */
  let quoted: QuotedFill | null = null;
  const intent = plan(account, rule, price);

  if (intent.kind === "trade" && decimals !== undefined) {
    try {
      quoted = await quoteFill({
        mint: rule.market,
        decimals,
        side: intent.side,
        size: intent.side === "buy" ? intent.usd : intent.qty,
        slippageBps: DEFAULTS.slippageBps,
      });
    } catch (e) {
      /*
       * A QUOTE THAT FAILS IS NOT A TRADE THAT SHOULD HAPPEN ANYWAY.
       *
       * Falling through to the model would price a trade against a number
       * Jupiter just declined to stand behind — which is the one moment the
       * model is guaranteed to be wrong, because "no route" means the
       * liquidity the model assumes is not there.
       *
       * `failed` rather than `moot`, so it retries: a pool can come back, and
       * three attempts is what the engine already gives every other transient
       * failure before it gives up loudly.
       */
      const why = e instanceof QuoteError ? e.message : "could not price that trade";
      await giveUp(rule, userId, now, transitions, why);
      return false;
    }
  }

  const outcome = fireRule(account, rule, {
    mark: price,
    ts: Math.floor(now / 1000),
    quoted,
  });

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
    if (rule.side === "sell" && positionOf(outcome.account, rule.market).qty <= 0) {
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
        /* A percentage becomes tokens HERE, against what this entry actually
           received — the fill, not the sentence. "$500 of SOL at $90" types
           as 5.556 and fills as 5.550; frozen early, a 100% stop would ask
           for tokens that never arrived. */
        await replace({
          ...child,
          amount: freezeAmount(child.amount, outcome.fill.qty),
          entryPrice: paid,
          highWater: paid,
          state: "armed",
        });
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
  } else if (outcome.kind === "hold") {
    /* A sell larger than the holding waits, attempts untouched — see the
       hold case in execute.ts. */
    await setState(rule.id, "armed");
    transitions.push({
      ruleId: rule.id,
      from: "firing",
      to: "armed",
      at: now,
      reason: `waiting: ${outcome.reason}`,
    });
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
    await giveUp(rule, userId, now, transitions, outcome.reason);
    return false;
  }

  await record(userId, transitions);
  return outcome.kind === "filled";
}
