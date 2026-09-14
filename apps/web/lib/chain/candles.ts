import type { Candle, Interval } from "../market/types.ts";
import { looksLikeMint } from "./tokens.ts";

/**
 * Candles for a token no exchange has ever listed.
 *
 * THE CHART LIBRARY WAS NEVER THE PROBLEM. cipher already draws with
 * lightweight-charts, which is TradingView's own renderer — it draws whatever
 * series it is handed. What it was being handed was Binance, and Binance lists
 * fourteen coins, so the entire Solana universe was chart-less by inheritance.
 * TradingView's hosted widget does not fix that either: it can only show
 * symbols TradingView indexes, which will never include a token minted four
 * minutes ago on a bonding curve.
 *
 * The data has to come from the chain's own venues. GeckoTerminal aggregates
 * OHLCV per POOL across Solana's DEXes, free and keyless, and that is what
 * this file turns into candles.
 *
 * TWO REQUESTS, NOT ONE, and the reason is that a token is not a market. A
 * mint can trade in twenty pools at once — BONK had exactly twenty when this
 * was written — each with its own price and its own depth. "The chart for
 * BONK" means the chart for the pool where BONK actually trades, so the pool
 * has to be chosen before candles can be asked for.
 */

const GECKO = "https://api.geckoterminal.com/api/v2/networks/solana";

/**
 * Free and keyless at 30 requests a minute, per IP.
 *
 * Tighter than Jupiter's 60, and the same arithmetic applies: a chart is a
 * property of the market rather than of the viewer, so one cached response
 * serves everyone looking at that token. Without the cache this breaks at the
 * thirtieth concurrent chart.
 */
const POOL_TTL = 300;
const CANDLE_TTL = 20;

export class CandleError extends Error {}

/**
 * Our interval → GeckoTerminal's timeframe and aggregate.
 *
 * They express "4 hours" as the hour timeframe aggregated by four rather than
 * as its own interval, so the mapping is a pair and not a string swap.
 */
const TIMEFRAME: Record<Interval, { frame: "minute" | "hour" | "day"; aggregate: number }> = {
  "1m": { frame: "minute", aggregate: 1 },
  "5m": { frame: "minute", aggregate: 5 },
  "15m": { frame: "minute", aggregate: 15 },
  "1h": { frame: "hour", aggregate: 1 },
  "4h": { frame: "hour", aggregate: 4 },
  "1d": { frame: "day", aggregate: 1 },
};

interface PoolRow {
  id: string;
  attributes?: { name?: string; reserve_in_usd?: string };
}

/**
 * The pool a token actually trades in: the deepest one.
 *
 * NOT the first one returned. GeckoTerminal's default ordering put a $272k
 * Bonk/SOL pool at the top of twenty, and charting the shallowest venue is how
 * you draw a wick that exists nowhere else — thin pools print prices that no
 * size could ever get. Depth is the only defensible tiebreak: the deepest pool
 * is where price discovery is real and where a trade of any size would route.
 */
export async function poolFor(mint: string): Promise<string | null> {
  if (!looksLikeMint(mint)) return null;

  const res = await fetch(`${GECKO}/tokens/${mint}/pools?page=1`, {
    headers: { Accept: "application/json" },
    next: { revalidate: POOL_TTL },
  });
  if (!res.ok) throw new CandleError(`GeckoTerminal pools returned ${res.status}`);

  const body = (await res.json()) as { data?: PoolRow[] };
  const pools = body.data ?? [];
  if (pools.length === 0) return null;

  let best: PoolRow | null = null;
  let deepest = -1;
  for (const p of pools) {
    const liq = Number(p.attributes?.reserve_in_usd ?? 0);
    if (Number.isFinite(liq) && liq > deepest) {
      deepest = liq;
      best = p;
    }
  }
  /* Ids come back network-prefixed — "solana_5zpy…" — and the OHLCV path
     wants the bare address. */
  return best ? best.id.replace(/^solana_/, "") : null;
}

export async function candlesFor(
  mint: string,
  interval: Interval,
  limit = 300,
): Promise<Candle[]> {
  const pool = await poolFor(mint);
  if (!pool) return [];
  return candlesForPool(pool, interval, limit);
}

export async function candlesForPool(
  pool: string,
  interval: Interval,
  limit = 300,
): Promise<Candle[]> {
  const { frame, aggregate } = TIMEFRAME[interval];
  const res = await fetch(
    `${GECKO}/pools/${pool}/ohlcv/${frame}?aggregate=${aggregate}&limit=${Math.min(limit, 1000)}`,
    { headers: { Accept: "application/json" }, next: { revalidate: CANDLE_TTL } },
  );
  if (!res.ok) throw new CandleError(`GeckoTerminal ohlcv returned ${res.status}`);

  const body = (await res.json()) as {
    data?: { attributes?: { ohlcv_list?: number[][] } };
  };
  const rows = body.data?.attributes?.ohlcv_list ?? [];

  /*
   * NEWEST FIRST UPSTREAM, oldest first for the chart. Reversing is not
   * cosmetic — lightweight-charts requires ascending time and silently draws
   * nothing when handed a descending series, which looks exactly like a token
   * with no history.
   */
  const candles: Candle[] = [];
  for (let i = rows.length - 1; i >= 0; i--) {
    const [time, open, high, low, close, volume] = rows[i];
    if (!Number.isFinite(time) || !Number.isFinite(close)) continue;
    candles.push({ time, open, high, low, close, volume: volume ?? 0 });
  }
  return candles;
}
