import type { WindowKey } from "./tokens.ts";

/**
 * Wallets by side — the one number Jupiter does not report.
 *
 * The activity panel wants "58 buyers / 100 sellers", and Jupiter has no split
 * of traders to give: `numTraders` is one figure covering both sides, and a
 * wallet that bought and then sold belongs to both halves of it, so it cannot
 * be solved backwards. DexScreener's `txns` counts transactions rather than
 * wallets, which is the number already on the first bar under a different noun.
 *
 * GeckoTerminal reports it directly, free and without a key:
 *
 *   transactions.h24 = { buys: 19077, sells: 21617, buyers: 2543, sellers: 2032 }
 *
 * WHAT IT COSTS, and it is not nothing. This is POOL-level. GeckoTerminal has
 * no token-level transaction counts at all, so the figures describe the
 * deepest pool rather than the whole market — and for a major that is a small
 * share of it: SOL's top twenty pools carry $352M of a $2.86B day, about an
 * eighth. For a memecoin with one or two pools it is very nearly the lot,
 * which is where cipher lives and what the panel is mostly read against.
 *
 * It is also the same vendor cipher moved OFF for candles on 16 Sep, after
 * GeckoTerminal reported an hourly high for SOL that no other venue saw. That
 * was their OHLC; this is a transaction count, a different endpoint and a much
 * harder number to get subtly wrong. The blast radius is also different — a
 * bad candle moves a chart people trade off, a bad buyer count is a stat.
 *
 * Failure is silent and total: no pool, no network, a shape we do not
 * recognise, and every window comes back null. The row then reads "—", the
 * rest of the card is untouched, and nothing waits on it.
 */

/** Our window keys → GeckoTerminal's. `4h` has no counterpart anywhere. */
const GECKO_WINDOW: Record<WindowKey, string | null> = {
  "5m": "m5",
  "1h": "h1",
  /*
   * NOTHING REPORTS FOUR HOURS. Jupiter has 5m/1h/6h/24h, DexScreener has
   * m5/h1/h6/h24, GeckoTerminal has m5/m15/m30/h1/h6/h24. Three feeds, three
   * different granularities, no four-hour window between them.
   */
  "4h": null,
  "24h": "h24",
};

export interface WalletsBySide {
  buyers: number;
  sellers: number;
}

interface PoolAttributes {
  volume_usd?: Record<string, string>;
  transactions?: Record<string, { buyers?: number; sellers?: number }>;
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * The deepest pool's buyers and sellers, per window.
 *
 * ONE POOL, NOT A SUM ACROSS THE PAGE. Adding twenty pools together would
 * double-count anyone who traded in more than one of them — these are unique
 * wallets, and unique wallets do not add. The single busiest pool is a figure
 * that means something exactly; a sum of overlapping sets is a figure that
 * means nothing in particular and looks more authoritative for it.
 */
export async function walletsBySide(
  mint: string,
): Promise<Partial<Record<WindowKey, WalletsBySide>>> {
  try {
    const res = await fetch(
      `https://api.geckoterminal.com/api/v2/networks/solana/tokens/${mint}/pools?page=1`,
      {
        headers: { Accept: "application/json" },
        /* Five minutes. Wallet counts move slowly and this is a second vendor
           on a path that already has one; the panel must not wait on it twice. */
        next: { revalidate: 300 },
      },
    );
    if (!res.ok) return {};

    const body = (await res.json()) as { data?: { attributes?: PoolAttributes }[] };
    const pools = Array.isArray(body.data) ? body.data : [];
    if (pools.length === 0) return {};

    /* Busiest by traded volume rather than by reserves: the panel is about
       activity, and a deep pool nobody trades in describes nothing. */
    const busiest = pools.reduce((best, p) =>
      Number(p.attributes?.volume_usd?.h24 ?? 0) > Number(best.attributes?.volume_usd?.h24 ?? 0)
        ? p
        : best,
    );

    const tx = busiest.attributes?.transactions;
    if (!tx) return {};

    const out: Partial<Record<WindowKey, WalletsBySide>> = {};
    for (const [ours, theirs] of Object.entries(GECKO_WINDOW) as [WindowKey, string | null][]) {
      if (!theirs) continue;
      const w = tx[theirs];
      if (!w) continue;
      /* Both sides zero means nobody traded, which is a real answer and worth
         rendering. Only a missing block is an absence. */
      out[ours] = { buyers: num(w.buyers), sellers: num(w.sellers) };
    }
    return out;
  } catch {
    /* A second vendor must never be able to take the first one's card down. */
    return {};
  }
}
