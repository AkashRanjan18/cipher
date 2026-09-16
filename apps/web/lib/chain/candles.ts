import type { Candle, Interval } from "../market/types.ts";
import { looksLikeMint } from "./tokens.ts";

/**
 * Candles for a token no exchange has ever listed.
 *
 * THE CHART LIBRARY WAS NEVER THE PROBLEM. cipher draws with
 * lightweight-charts, which is TradingView's own renderer — it draws whatever
 * series it is handed. What it was handed was Binance, which lists fourteen
 * coins, so the entire Solana universe was chart-less by inheritance.
 *
 * WHY THIS IS JUPITER AND NOT GECKOTERMINAL, which it was until 16 Sep 2026.
 *
 * GeckoTerminal reported an hourly high of $117.65 for SOL on 14 September.
 * Binance's high that hour was $102.87 and Jupiter's was $103.01 — a 14% move
 * that the largest SOL venue on earth never printed. The bad value appeared
 * identically, to the cent, in three separate pools, so it was one corrupt
 * figure propagating through their records rather than three real trades.
 *
 * Three further things fall out of the switch, and any one of them would have
 * justified it on its own:
 *
 *   ONE REQUEST, NOT TWO. GeckoTerminal charts a POOL, so every cold chart
 *   cost a pool lookup and then the candles — thirty requests a minute of free
 *   tier buying fifteen charts. Jupiter charts a TOKEN.
 *
 *   NO POOL TO CHOOSE. Picking one meant picking the deepest where the mint is
 *   the base, and getting that wrong drew a different coin entirely: SOL's
 *   deepest pool is WOFI/SOL, so depth alone once charted WOFI's price under
 *   the name SOL. That whole class of bug is now unreachable.
 *
 *   ONE VENDOR. The header price, the trigger engine and the chart all read
 *   Jupiter, so they agree by construction instead of by coincidence.
 */

const BASE = "https://datapi.jup.ag/v2/charts";

/** Our intervals → Jupiter's enum. Rejected values come back as a 400. */
const INTERVAL: Record<Interval, string> = {
  "1m": "1_MINUTE",
  "5m": "5_MINUTE",
  "15m": "15_MINUTE",
  "1h": "1_HOUR",
  "4h": "4_HOUR",
  "1d": "1_DAY",
};

export class CandleError extends Error {}

/**
 * Upstream said slow down. A different thing from upstream being broken.
 *
 * Its own class because the caller renders them differently: "too many charts
 * at once, try again in a moment" is actionable and true, while "unavailable"
 * reads as the token being broken and sends the user away from something that
 * works fine.
 */
export class RateLimited extends CandleError {}

interface Row {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export async function candlesFor(
  mint: string,
  interval: Interval,
  limit = 300,
): Promise<Candle[]> {
  /* Not a mint means not a Solana market — a Binance pair reaching this far is
     a routing bug, and sending it upstream would only turn it into a 400. */
  if (!looksLikeMint(mint)) return [];

  const key = process.env.JUPITER_API_KEY;
  const params = new URLSearchParams({
    interval: INTERVAL[interval],
    /* MILLISECONDS. Seconds are accepted and return an empty series — a
       silent wrong answer, which is the worst shape a unit bug can take. */
    to: String(Date.now()),
    candles: String(Math.min(Math.max(limit, 1), 2000)),
  });

  const res = await fetch(`${BASE}/${mint}?${params}`, {
    headers: key
      ? { Accept: "application/json", "x-api-key": key }
      : { Accept: "application/json" },
    /*
     * Twenty seconds. A chart is a property of the market rather than of the
     * viewer, so one cached response serves everyone looking at that token —
     * which is what keeps a thousand open terminals inside an allowance
     * measured per deployment.
     */
    next: { revalidate: 20 },
  });

  if (!res.ok) {
    if (res.status === 429) throw new RateLimited("Jupiter charts rate limited");
    throw new CandleError(`Jupiter charts returned ${res.status}`);
  }

  const body = (await res.json()) as { candles?: Row[] };
  const rows = Array.isArray(body.candles) ? body.candles : [];

  /*
   * STRICTLY ASCENDING, and the word is load-bearing. lightweight-charts
   * asserts on equal timestamps, not only descending ones:
   *
   *   Assertion failed: data must be asc ordered by time,
   *   index=299, time=1789290840, prev time=1789290840
   *
   * which is a red runtime overlay over the whole terminal, not a bad chart.
   * Jupiter returns ascending and unique today; enforcing it here costs one
   * pass and means a feed that changes its mind cannot take the app down.
   */
  const seen = new Set<number>();
  const candles: Candle[] = [];
  for (const r of rows) {
    if (!Number.isFinite(r?.time) || !Number.isFinite(r?.close)) continue;
    if (seen.has(r.time)) continue;
    seen.add(r.time);
    candles.push({
      time: r.time,
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      /* Dollars, not base units — see the volume note in terminal.tsx. */
      volume: Number.isFinite(r.volume) ? r.volume : 0,
    });
  }
  candles.sort((a, b) => a.time - b.time);
  return candles;
}
