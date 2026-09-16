import type { Candle, Interval } from "../market/types.ts";
import { looksLikeMint } from "./tokens.ts";

/**
 * Candles for a token no exchange has ever listed.
 *
 * THE CHART LIBRARY WAS NEVER THE PROBLEM. cipher draws with
 * lightweight-charts, which is TradingView's own renderer — and so does fomo,
 * whose bundle ships `lightweight-charts.production-v2-*.js`. Same renderer,
 * same options. Every difference between the two charts is data.
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

/** How long one bar covers, which is what decides which bucket a row lands in. */
const SECONDS: Record<Interval, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3_600,
  "4h": 14_400,
  "1d": 86_400,
};

/**
 * WHY EVERY BAR IS FOLDED FROM SMALLER ONES INSTEAD OF ASKED FOR DIRECTLY.
 *
 * Jupiter's own 1-minute candle has the right body and the wrong wick. Aligned
 * against Binance over 300 consecutive minutes of SOL:
 *
 *              jupiter   binance
 *     body      0.0354%   0.0410%     the bodies agree
 *     up wick   0.0658%   0.0103%     6.4x
 *     dn wick   0.0411%   0.0103%     4.0x
 *
 *   median |jupiter close − binance close|  0.0078%
 *   jupiter's high exceeded binance's high on 283 of the 300 minutes
 *
 * So the CLOSES are exact — Jupiter agrees with the largest SOL venue on earth
 * to eight ten-thousandths of a percent — and the extremes are not. The excess
 * is also lopsided: the high runs 0.052% hot while the low runs only 0.026%
 * cold. A genuinely wider market would be symmetric. Lopsided and near-constant
 * means it is structural, and the structure is this: Jupiter's high is the
 * maximum across EVERY pool holding the token, thin ones included. Nobody can
 * trade that number. Routing exists precisely to avoid the pool that printed it.
 *
 * A candle on a trading terminal should describe the price you would have got,
 * so the high and low are taken from the ROUTED price at checkpoints through
 * the bar — the opens and closes of finer candles, which are the same series
 * whose closes match Binance — rather than from the outer edge of the market.
 *
 * Measured the same way, the rebuilt bar lands where it should:
 *
 *              rebuilt   jupiter   binance
 *     wick/body   0.29x     2.98x     0.50x
 *     close       identical to jupiter's, to the digit
 *
 * Slightly tighter than Binance, because a 15-second checkpoint cannot see a
 * spike that began and ended between two checkpoints. That is the honest cost
 * and it is the right direction to err: a missing wick understates, a wick
 * built from a pool you would never route through lies.
 *
 * THE COUNTS ARE CHOSEN SO THIS STAYS ONE REQUEST. Jupiter caps a response at
 * 2000 candles; at the default 300 bars the largest fold asks for 1800.
 */
const FOLD: Record<Interval, { fine: string; per: number }> = {
  "1m": { fine: "15_SECOND", per: 4 },
  "5m": { fine: "1_MINUTE", per: 5 },
  "15m": { fine: "5_MINUTE", per: 3 },
  "1h": { fine: "15_MINUTE", per: 4 },
  "4h": { fine: "1_HOUR", per: 4 },
  "1d": { fine: "4_HOUR", per: 6 },
};

/** Jupiter's ceiling on a single response. */
const MAX_ROWS = 2000;

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

async function rows(mint: string, jupInterval: string, count: number): Promise<Row[]> {
  const key = process.env.JUPITER_API_KEY;
  const params = new URLSearchParams({
    interval: jupInterval,
    /* MILLISECONDS. Seconds are accepted and return an empty series — a
       silent wrong answer, which is the worst shape a unit bug can take. */
    to: String(Date.now()),
    candles: String(Math.min(Math.max(count, 1), MAX_ROWS)),
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
  return Array.isArray(body.candles) ? body.candles : [];
}

/**
 * Fine rows → bars of `span` seconds.
 *
 * STRICTLY ASCENDING, and the word is load-bearing. lightweight-charts asserts
 * on equal timestamps, not only descending ones:
 *
 *   Assertion failed: data must be asc ordered by time,
 *   index=299, time=1789290840, prev time=1789290840
 *
 * which is a red runtime overlay over the whole terminal, not a bad chart.
 * Bucketing gives uniqueness for free — two rows landing in the same minute
 * become one bar rather than two bars sharing a timestamp — so the guarantee
 * is now a property of the shape instead of a pass that has to remember to run.
 */
function fold(input: Row[], span: number): Candle[] {
  const bars = new Map<number, Candle>();

  /* Ascending first: `open` is the FIRST checkpoint of the bar and `close` the
     last, and neither means anything if the rows arrive out of order. */
  const sorted = input
    .filter((r) => Number.isFinite(r?.time) && Number.isFinite(r?.close))
    .sort((a, b) => a.time - b.time);

  for (const r of sorted) {
    const t = Math.floor(r.time / span) * span;
    /* The routed price at this checkpoint, at both ends of the fine bar. Its
       own high and low are deliberately ignored — they are the cross-pool
       extremes this whole function exists to leave out. */
    const lo = Math.min(r.open, r.close);
    const hi = Math.max(r.open, r.close);
    const volume = Number.isFinite(r.volume) ? r.volume : 0;

    const bar = bars.get(t);
    if (!bar) {
      bars.set(t, { time: t, open: r.open, high: hi, low: lo, close: r.close, volume });
      continue;
    }
    bar.high = Math.max(bar.high, hi);
    bar.low = Math.min(bar.low, lo);
    bar.close = r.close;
    /* Dollars, not base units — see the volume note in terminal.tsx. Summed,
       because every fine bar inside this one is disjoint from the others. */
    bar.volume += volume;
  }

  return [...bars.values()].sort((a, b) => a.time - b.time);
}

export async function candlesFor(
  mint: string,
  interval: Interval,
  limit = 300,
): Promise<Candle[]> {
  /* Not a mint means not a Solana market — a Binance pair reaching this far is
     a routing bug, and sending it upstream would only turn it into a 400. */
  if (!looksLikeMint(mint)) return [];

  const { fine, per } = FOLD[interval];
  const span = SECONDS[interval];

  /*
   * TRIMMED, because `limit * per` fine candles is not `limit` bars.
   *
   * Jupiter emits a fine candle where there was trading, not on every tick of
   * the clock, so on a thin token 1200 fifteen-second candles can reach back
   * ten hours rather than five: BONK folded to 582 bars against a request for
   * 300. Free history is not a gift here — `barSpacing: 9` with a 12-bar right
   * offset frames the recent end either way, so the surplus is invisible and
   * still gets laid out and hit-tested on every redraw. The caller asked for
   * a number; the last `limit` of them are the ones it meant.
   */
  const folded = fold(await rows(mint, fine, limit * per), span);
  if (folded.length > 0) return folded.slice(-limit);

  /*
   * NOTHING AT THE FINE INTERVAL IS NOT THE SAME AS NOTHING AT ALL. A token
   * minted four minutes ago has no 15-minute history to fold into an hourly
   * bar, and a chart-less token reads to the user as a broken one. Falling
   * back to the interval as asked costs a second request on exactly the tokens
   * where the first returned nothing, and never on a token that is trading.
   *
   * Folding this too — span into span — leaves the timestamps alone and still
   * buys the ascending-and-unique guarantee the renderer asserts on.
   */
  return fold(await rows(mint, INTERVAL[interval], limit), span).slice(-limit);
}
