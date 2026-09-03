import type { Major } from "./types";

/**
 * Blue-chip prices for the sidebar list and the bottom ticker.
 *
 * These are not Solana pool prices — BTC and ETH do not trade on a Solana AMM
 * in any meaningful size, so DexScreener is the wrong source. CoinGecko's
 * coins/markets is the right shape, needs no key, and returns the logo in the
 * same response — a second call per coin just for an icon would be absurd.
 *
 * cipher: keyless CoinGecko is roughly 10-30 calls/minute per IP and shared
 * across all users like every other feed here. The ticker is cached for a
 * minute, which is far inside that. A key raises it if the bar ever justifies
 * the cost.
 */

const ENDPOINT = "https://api.coingecko.com/api/v3/coins/markets";

/**
 * CoinGecko ids, and the ticker each maps to.
 *
 * Ordered — the sidebar and the bottom bar both render in this sequence, and
 * a list that reorders itself as prices move is unreadable.
 */
const MAJORS: { id: string; symbol: string }[] = [
  { id: "bitcoin", symbol: "BTC" },
  { id: "ethereum", symbol: "ETH" },
  { id: "solana", symbol: "SOL" },
  { id: "ripple", symbol: "XRP" },
  { id: "binancecoin", symbol: "BNB" },
  { id: "hyperliquid", symbol: "HYPE" },
  { id: "tron", symbol: "TRX" },
  { id: "zcash", symbol: "ZEC" },
  { id: "dogecoin", symbol: "DOGE" },
];

interface RawCoin {
  id: string;
  image?: string;
  current_price?: number;
  price_change_percentage_24h?: number;
  market_cap?: number;
}

/** Exported for testing without a network call. */
export function toMajors(rows: RawCoin[]): Major[] {
  const byId = new Map(rows.map((r) => [r.id, r]));

  return (
    MAJORS
      /*
       * Driven by our ordered list, not by the response order. CoinGecko sorts
       * by market cap by default, so BTC and ETH would swap places on the day
       * one flips the other — and a sidebar whose rows move under the cursor
       * is unusable as a glance target.
       */
      .map(({ id, symbol }) => {
        const r = byId.get(id);
        if (!r || typeof r.current_price !== "number") return null;
        return {
          id,
          symbol,
          imageUrl: r.image ?? null,
          priceUsd: r.current_price,
          change24h: r.price_change_percentage_24h ?? 0,
          marketCap: r.market_cap ?? null,
        };
      })
      // A coin the API omitted is dropped, never rendered as $0.
      .filter((m): m is Major => m !== null)
  );
}

export async function fetchMajors(): Promise<Major[]> {
  const ids = MAJORS.map((m) => m.id).join(",");
  const res = await fetch(`${ENDPOINT}?vs_currency=usd&ids=${ids}`, {
    headers: { Accept: "application/json" },
    next: { revalidate: 60 },
  });
  if (!res.ok) return [];

  return toMajors((await res.json()) as RawCoin[]);
}
