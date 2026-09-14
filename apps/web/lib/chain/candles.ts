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
 * Free and keyless at 30 requests a minute, PER IP AND PER DEPLOYMENT.
 *
 * Tighter than Jupiter's 60, and worse than it sounds: a cold chart costs TWO
 * requests, not one — the pool lookup and then the candles. So the real budget
 * is fifteen new tokens a minute across every user at once, and browsing a
 * launch feed quickly walks straight into it. Measured, not guessed: a sweep
 * of fourteen tokens back to back got seven 502s.
 *
 * Two things hold it back. The pool for a mint barely changes, so that half is
 * cached for half an hour rather than five minutes — repeat views of a token
 * cost one request, and a token seen before costs none. And a rate-limited
 * response is reported AS rate-limited, so the UI can say something true
 * instead of showing the same blank chart it shows for a token with no
 * history.
 */
const POOL_TTL = 1_800;
const CANDLE_TTL = 20;

export class CandleError extends Error {}

/**
 * Upstream said slow down. A different thing from upstream being broken.
 *
 * Kept as its own class because the caller renders them differently: "too many
 * charts at once, try again in a moment" is actionable and true, while
 * "unavailable" reads as the token being broken and sends the user away from
 * something that works fine.
 */
export class RateLimited extends CandleError {}

function fail(status: number, what: string): never {
  if (status === 429) throw new RateLimited(`GeckoTerminal ${what} rate limited`);
  throw new CandleError(`GeckoTerminal ${what} returned ${status}`);
}

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
  relationships?: {
    base_token?: { data?: { id?: string } };
    quote_token?: { data?: { id?: string } };
  };
}

/**
 * The pool a token actually trades in: the deepest one WHERE IT IS THE BASE.
 *
 * Two filters, and both were learned by getting it wrong.
 *
 * BASE, NOT EITHER SIDE. A pool's OHLCV is the price of its BASE token, so a
 * pool where our mint is the quote gives the price of the other token. SOL's
 * deepest pool is `WOFI / SOL` at $90M — deeper than either SOL/USDC pool —
 * so picking on depth alone charted WOFI's price under the name SOL, complete
 * with a plausible axis. A chart showing a different asset's price under the
 * right ticker is the worst failure this file can have, because nothing about
 * it looks broken.
 *
 * DEEPEST, NOT FIRST. GeckoTerminal's default ordering put a $272k Bonk/SOL
 * pool at the top of twenty. Thin pools print prices no size could ever get,
 * so the deepest is where price discovery is real and where a trade would
 * actually route.
 *
 * Null when the token is the base of nothing — no chart, rather than a chart
 * of something else.
 */
export async function poolFor(mint: string): Promise<string | null> {
  if (!looksLikeMint(mint)) return null;

  const res = await fetch(`${GECKO}/tokens/${mint}/pools?page=1`, {
    headers: { Accept: "application/json" },
    next: { revalidate: POOL_TTL },
  });
  if (!res.ok) fail(res.status, "pools");

  const body = (await res.json()) as { data?: PoolRow[] };
  const pools = body.data ?? [];

  let best: PoolRow | null = null;
  let deepest = -1;
  for (const p of pools) {
    const base = p.relationships?.base_token?.data?.id?.replace(/^solana_/, "");
    if (base !== mint) continue;
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
  if (!res.ok) fail(res.status, "ohlcv");

  const body = (await res.json()) as {
    data?: { attributes?: { ohlcv_list?: number[][] } };
  };
  const rows = body.data?.attributes?.ohlcv_list ?? [];

  /*
   * NEWEST FIRST UPSTREAM, oldest first for the chart. Reversing is not
   * cosmetic — lightweight-charts requires ascending time and silently draws
   * nothing when handed a descending series, which looks exactly like a token
   * with no history.
   *
   * STRICTLY ascending, and the word is load-bearing. The library asserts on
   * equal timestamps, not just on descending ones:
   *
   *   Assertion failed: data must be asc ordered by time,
   *   index=299, time=1789290840, prev time=1789290840
   *
   * which is a red runtime overlay over the whole app, not a bad chart.
   * GeckoTerminal repeats a bucket — the still-forming one arrives twice near
   * the head of the list — so a plain reverse carries the duplicate through.
   *
   * The LATER row wins. Walking newest-first, the first copy seen of a given
   * timestamp is the most recently updated one, and for the bucket still being
   * filled that is the only one with the current close in it. Keeping the
   * earlier copy would draw a candle that is a few seconds stale at the exact
   * end of the series a trader is looking at.
   */
  const candles: Candle[] = [];
  const seen = new Set<number>();
  for (const row of rows) {
    const [time, open, high, low, close, volume] = row;
    if (!Number.isFinite(time) || !Number.isFinite(close)) continue;
    if (seen.has(time)) continue;
    seen.add(time);
    candles.push({ time, open, high, low, close, volume: volume ?? 0 });
  }
  /* Sorted rather than assumed: the dedupe above trusts the upstream order to
     pick the right duplicate, but not to be perfectly monotonic. One pass over
     a few hundred rows costs nothing and makes the invariant true by
     construction instead of by hope. */
  candles.sort((a, b) => a.time - b.time);
  return candles;
}
