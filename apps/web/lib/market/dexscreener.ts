import type { TokenStats } from "./types";

/**
 * Token stats from DexScreener. Free, keyless, no signup.
 *
 * A token trades in many pools at slightly different prices. DexScreener
 * returns all of them; we take the deepest, because the deepest pool is
 * where a real order would route and its price is the one that matters.
 * Taking the first result instead would sometimes quote a $2k pool.
 */

const ENDPOINT = "https://api.dexscreener.com/latest/dex/tokens";

interface DsPair {
  pairAddress: string;
  dexId: string;
  baseToken: { symbol: string; name: string };
  priceUsd: string;
  marketCap?: number;
  fdv?: number;
  liquidity?: { usd?: number };
  volume?: { h24?: number };
  priceChange?: { h24?: number };
  txns?: { h24?: { buys: number; sells: number } };
  info?: {
    imageUrl?: string;
    websites?: { url: string; label?: string }[];
    socials?: { type: string; url: string }[];
  };
}

/** Exported for testing without a network call. */
export function pickDeepestPair(pairs: DsPair[]): DsPair | null {
  if (!pairs?.length) return null;
  return pairs.reduce((best, p) =>
    (p.liquidity?.usd ?? 0) > (best.liquidity?.usd ?? 0) ? p : best,
  );
}

export function normalise(mint: string, pair: DsPair): TokenStats {
  return {
    mint,
    pairAddress: pair.pairAddress,
    symbol: pair.baseToken.symbol,
    name: pair.baseToken.name,
    dex: pair.dexId,
    // priceUsd arrives as a string; a token at 3e-6 must not lose precision.
    priceUsd: Number(pair.priceUsd),
    // Absent is not zero. A missing market cap means unknown supply.
    marketCap: pair.marketCap ?? null,
    fdv: pair.fdv ?? null,
    liquidityUsd: pair.liquidity?.usd ?? 0,
    volume24h: pair.volume?.h24 ?? 0,
    change24h: pair.priceChange?.h24 ?? 0,
    buys24h: pair.txns?.h24?.buys ?? 0,
    sells24h: pair.txns?.h24?.sells ?? 0,
    imageUrl: pair.info?.imageUrl ?? null,
    /*
     * Websites and socials arrive as separate arrays with different shapes;
     * flattening them here keeps the "link out" logic in one place instead of
     * making every consumer know the difference.
     */
    socials: [
      ...(pair.info?.websites ?? []).map((w) => ({
        type: "website",
        url: w.url,
      })),
      ...(pair.info?.socials ?? []),
    ],
  };
}

export async function fetchTokenStats(mint: string): Promise<TokenStats | null> {
  const res = await fetch(`${ENDPOINT}/${mint}`, {
    // Prices move constantly, but a page render does not need per-second
    // freshness and DexScreener rate-limits. 30s is the compromise.
    next: { revalidate: 30 },
  });
  if (!res.ok) return null;

  const data = (await res.json()) as { pairs: DsPair[] | null };
  const pair = pickDeepestPair(data.pairs ?? []);
  return pair ? normalise(mint, pair) : null;
}
