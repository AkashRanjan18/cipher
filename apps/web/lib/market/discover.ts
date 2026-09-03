import type { PoolSummary } from "./types";

/**
 * Discovery — trending, new, and search.
 *
 * Without this the terminal has no front door: the only way to reach a token
 * is to paste a mint into the URL. Every competitor opens on a list, because
 * choosing what to trade is the first decision, not the second.
 *
 * Both sources are keyless.
 */

const GECKO = "https://api.geckoterminal.com/api/v2/networks/solana";
const GECKO_SEARCH = "https://api.geckoterminal.com/api/v2/search/pools";

/* ---------------------------------------------------------------- gecko -- */

interface GeckoPool {
  attributes: {
    address: string;
    /** "BEN / USDC" — base and quote, slash-separated. */
    name: string;
    pool_created_at: string | null;
    base_token_price_usd: string;
    price_change_percentage: Record<string, string>;
    volume_usd: Record<string, string>;
    reserve_in_usd: string;
  };
  relationships: {
    /** "solana_<mint>" — the network is prefixed onto the id. */
    base_token: { data: { id: string } };
    dex: { data: { id: string } };
  };
}

/**
 * GeckoTerminal reports numbers as strings to avoid float precision loss on
 * its side, which pushes the problem here. Anything unparseable becomes 0
 * rather than NaN — a NaN reaches the DOM as "NaN" and looks like a crash.
 */
function num(v: string | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Same, but keeps "absent" distinct from "zero".
 *
 * Not all pools report every window. Collapsing a missing 1h change to 0
 * prints "+0.0%" on the rail, and a trader reads that as "flat" when the
 * truth is "unknown" — a claim about the market we cannot support.
 */
function numOrNull(v: string | undefined): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Exported for testing without a network call. */
export function toPoolSummaries(pools: GeckoPool[]): PoolSummary[] {
  return pools.map((p) => {
    const a = p.attributes;
    return {
      pairAddress: a.address,
      // Strip the network prefix; the route wants the bare mint.
      mint: p.relationships.base_token.data.id.replace(/^solana_/, ""),
      /*
       * cipher: the base symbol is the left half of "BEN / USDC". A token
       * whose own symbol contains " / " would split wrong — vanishingly rare,
       * and the alternative is an extra request per row to resolve the token.
       */
      symbol: a.name.split(" / ")[0]?.trim() ?? a.name,
      dex: p.relationships.dex.data.id,
      priceUsd: num(a.base_token_price_usd),
      change1h: numOrNull(a.price_change_percentage?.h1),
      change24h: numOrNull(a.price_change_percentage?.h24),
      volume24h: num(a.volume_usd?.h24),
      liquidityUsd: num(a.reserve_in_usd),
      createdAt: a.pool_created_at
        ? Math.floor(new Date(a.pool_created_at).getTime() / 1000)
        : null,
    };
  });
}

/**
 * cipher: GeckoTerminal's free tier is ~30 requests/minute PER IP, and every
 * user proxies through our server, so that 30 is the whole app's budget —
 * not each visitor's. Ceiling is roughly a dozen concurrently-viewed tokens
 * before 429s start. Upgrade path is a paid CoinGecko onchain key or Birdeye,
 * behind these same functions.
 *
 * Until then the defence is cache windows wide enough that upstream traffic
 * is bounded by revalidate, not by user count.
 */
async function geckoList(path: string): Promise<PoolSummary[]> {
  const res = await fetch(`${GECKO}/${path}`, {
    headers: { Accept: "application/json" },
    // A rail that reorders faster than a minute is noise, not information.
    next: { revalidate: 60 },
  });
  /*
   * A 429 and an empty list are indistinguishable downstream, and an empty
   * rail reads as "nothing is trending" — a false statement about the market.
   * Throwing hands it to the caller, which keeps the last good render.
   */
  if (res.status === 429) throw new Error("geckoterminal: rate limited");
  if (!res.ok) return [];
  const data = (await res.json()) as { data?: GeckoPool[] };
  return toPoolSummaries(data.data ?? []);
}

export function fetchTrending(): Promise<PoolSummary[]> {
  return geckoList("trending_pools?duration=1h");
}

export function fetchNewPools(): Promise<PoolSummary[]> {
  return geckoList("new_pools");
}

/* --------------------------------------------------------------- search -- */

/**
 * Does this look like a Solana mint rather than a ticker?
 *
 * Base58, 32-44 chars. Solana's alphabet omits 0, O, I and l precisely so a
 * mispasted address fails validation instead of silently resolving to a
 * different account — which on a trading app means buying the wrong token.
 */
export function isMintAddress(q: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(q.trim());
}

/**
 * Search runs on GeckoTerminal, NOT DexScreener, and the reason is concrete.
 *
 * DexScreener's search caps at 30 results ranked by its own cross-chain
 * relevance. Querying "wif" returns Ethereum, Robinhood, TON and Cronos
 * tokens named WIF; the real Solana dogwifhat is not in the response at all,
 * so no amount of client-side filtering or re-sorting can surface it. A
 * search box that cannot find dogwifhat is not a search box.
 *
 * GeckoTerminal takes `network=solana` upstream and returns the genuine
 * $WIF / SOL pool first. It also returns the same pool shape as trending,
 * so toPoolSummaries maps it unchanged.
 */
export async function searchPools(query: string): Promise<PoolSummary[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const res = await fetch(
    `${GECKO_SEARCH}?query=${encodeURIComponent(q)}&network=solana`,
    { headers: { Accept: "application/json" }, next: { revalidate: 60 } },
  );
  if (res.status === 429) throw new Error("geckoterminal: rate limited");
  if (!res.ok) return [];

  const data = (await res.json()) as { data?: GeckoPool[] };
  return (
    toPoolSummaries(data.data ?? [])
      /*
       * A memecoin ticker is not unique — "wif" matches WIFE, KWIF, SWIF and
       * a dozen deliberate clones. Ranking by liquidity puts the token a
       * trader actually means on top; upstream relevance would not.
       */
      .sort((a, b) => b.liquidityUsd - a.liquidityUsd)
      .slice(0, 20)
  );
}
