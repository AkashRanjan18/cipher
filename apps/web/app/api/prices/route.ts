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
    const prices = await fetchPrices(mints);

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
