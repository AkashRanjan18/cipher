import type { SolPrice } from "../chain/prices.ts";
import { db, num } from "./client.ts";

/**
 * What the engine saw, written down.
 *
 * A transition already records the price that fired a rule, which answers "why
 * did you sell my SOL". This answers a different question: "was the feed sane
 * at the time" — and the two are not the same. A fire at $71 is defensible if
 * the feed was moving and indefensible if it had been stuck on one slot for
 * ten minutes, and only a record of the feed itself can tell them apart.
 *
 * Two tables, on purpose:
 *
 *   market_prices   the LATEST price per mint. One row per market, upserted.
 *                   This is what a cold worker reads before it has fetched
 *                   anything, and what the UI falls back to.
 *
 *   price_ticks     append-only history. The audit trail for the feed, and the
 *                   raw material for building candles on tokens no data vendor
 *                   covers — which is every interesting one.
 */

type Row = Record<string, unknown>;

export async function recordPrices(prices: SolPrice[]): Promise<void> {
  if (prices.length === 0) return;
  const sql = db();
  const at = Date.now();

  for (const p of prices) {
    /*
     * Upsert guarded on block_id.
     *
     * Two workers, or a worker and a browser, can write the same market within
     * the same second with prices derived at DIFFERENT slots. Without the
     * guard, whichever arrives second wins — which can mean an older price
     * overwriting a newer one. The chain's own ordering settles it.
     */
    await sql`
      insert into market_prices (mint, usd, block_id, liquidity_usd, change_24h, at)
      values (${p.mint}, ${p.usd}, ${p.blockId}, ${p.liquidityUsd}, ${p.change24h}, ${at})
      on conflict (mint) do update set
        usd = excluded.usd,
        block_id = excluded.block_id,
        liquidity_usd = excluded.liquidity_usd,
        change_24h = excluded.change_24h,
        at = excluded.at
      where market_prices.block_id <= excluded.block_id
    `;
  }

  /*
   * History is sampled, not every call.
   *
   * The price route may be hit several times a second across users; storing
   * each would be a row per user per second for a number that is identical
   * across all of them. One tick per mint per ten seconds is enough to
   * reconstruct what the feed was doing, and is the granularity a one-minute
   * candle needs anyway.
   */
  const bucket = Math.floor(at / 10_000) * 10_000;
  for (const p of prices) {
    await sql`
      insert into price_ticks (mint, usd, block_id, bucket)
      values (${p.mint}, ${p.usd}, ${p.blockId}, ${bucket})
      on conflict (mint, bucket) do nothing
    `;
  }
}

/** The last price written for each mint. What a cold worker starts from. */
export async function lastPrices(mints: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (mints.length === 0) return out;
  const rows = (await db()`
    select mint, usd from market_prices where mint = any(${mints})
  `) as Row[];
  for (const r of rows) out.set(String(r.mint), num(r.usd));
  return out;
}

/**
 * Raw ticks for one market, oldest first.
 *
 * The input to candles for a token nobody sells OHLCV for. Not used yet, and
 * the table it reads exists precisely so that the history is accumulating
 * before the feature needs it — you cannot backfill a price feed.
 */
export async function ticksSince(mint: string, since: number, limit = 2000): Promise<
  { usd: number; at: number }[]
> {
  const rows = (await db()`
    select usd, bucket from price_ticks
    where mint = ${mint} and bucket >= ${since}
    order by bucket asc
    limit ${limit}
  `) as Row[];
  return rows.map((r) => ({ usd: num(r.usd), at: num(r.bucket) }));
}
