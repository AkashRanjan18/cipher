import { NextResponse } from "next/server";
import {
  searchPools,
  fetchTokenStats,
  isMintAddress,
  type PoolSummary,
} from "@/lib/market";

/**
 * Token search. Called on a debounce as the user types, so it must be cheap.
 *
 * Goes through our server for the same reasons as the other market routes:
 * one upstream IP, Next's cache in front of it, provider swappable.
 */

export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  // Two characters is the floor where results mean anything; below it the
  // query matches half the chain and costs a request to say so.
  if (q.length < 2) return NextResponse.json({ results: [] });

  try {
    /*
     * A pasted contract address is how memecoin traders actually arrive —
     * from a Telegram call or a post on X, never by typing a ticker. Text
     * search on a mint returns nothing, so resolve it directly instead,
     * through the same lookup the token page uses. That guarantees the row
     * they click matches the page they land on.
     */
    if (isMintAddress(q)) {
      const stats = await fetchTokenStats(q);
      if (!stats) return NextResponse.json({ results: [] });
      const row: PoolSummary = {
        pairAddress: stats.pairAddress,
        mint: stats.mint,
        imageUrl: stats.imageUrl,
        symbol: stats.symbol,
        dex: stats.dex,
        priceUsd: stats.priceUsd,
        change1h: null,
        change24h: stats.windows.h24.change,
        volume24h: stats.windows.h24.volume,
        liquidityUsd: stats.liquidityUsd,
        fdv: stats.fdv,
        createdAt: null,
      };
      return NextResponse.json({ results: [row] });
    }

    return NextResponse.json({ results: await searchPools(q) });
  } catch {
    /*
     * Upstream rate limit. 503 rather than an empty list, so the rail can say
     * "unavailable" instead of "no matches" — the second is a claim about the
     * market that we cannot support.
     */
    return NextResponse.json({ error: "search unavailable" }, { status: 503 });
  }
}
