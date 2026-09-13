import { NextResponse } from "next/server";
import { ALL_MINTS } from "@/lib/chain/markets";
import { fetchPrices, newestBlock } from "@/lib/chain/prices";
import { hasDb } from "@/lib/db/client";
import { recordPrices } from "@/lib/db/prices";

/**
 * Solana prices, for everyone at once.
 *
 * Through the server rather than from the browser for the same reason candles
 * are: a thousand open terminals asking Jupiter directly is a thousand
 * requests from a thousand IPs, and the free tier is per-IP. Next's cache
 * turns them into one.
 *
 * It also writes what it saw. The engine's decisions are only auditable if the
 * price it decided on was recorded — "why did this fire" is answerable from a
 * transition, but "was the feed sane at the time" is a question about the feed.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const asked = new URL(request.url).searchParams.get("mints");
  const mints = asked ? asked.split(",").filter(Boolean).slice(0, 50) : ALL_MINTS;

  try {
    /*
     * TWO SECONDS OF CACHE IS WHAT MAKES THIS SURVIVABLE.
     *
     * Jupiter's keyless allowance is thirty requests a minute for the whole
     * deployment. A thousand terminals refreshing a price board would exhaust
     * that in under two seconds; cached, they are one request and the board
     * stays live. Two seconds is also shorter than anyone perceives on a quote
     * that is not being traded against — and nothing trades against this one,
     * because the worker fetches its own uncached.
     */
    const prices = await fetchPrices(mints, { revalidate: 2 });

    /*
     * Recording is best-effort and deliberately not awaited into the failure
     * path: a price that cannot be written to the audit log is still a price
     * the user should see. The alternative is a dead quote board because a
     * database is asleep.
     */
    if (hasDb()) {
      void recordPrices([...prices.values()]).catch((e) =>
        console.error("[cipher] price snapshot failed:", e),
      );
    }

    return NextResponse.json({
      prices: Object.fromEntries(
        [...prices].map(([mint, p]) => [
          mint,
          { usd: p.usd, blockId: p.blockId, liquidityUsd: p.liquidityUsd, change24h: p.change24h },
        ]),
      ),
      /* The newest slot anything was derived at, so a client can tell a flat
         market from a dead feed without asking a second question. */
      blockId: newestBlock(prices),
    });
  } catch (e) {
    console.error("[cipher] prices failed:", e);
    return NextResponse.json({ error: "prices unavailable" }, { status: 502 });
  }
}
