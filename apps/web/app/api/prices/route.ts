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
     * FIVE SECONDS, AND THE NUMBER IS ARITHMETIC RATHER THAN TASTE.
     *
     * Jupiter's keyless allowance is thirty requests a minute for the WHOLE
     * deployment. A cache window of N seconds costs at most 60/N of that
     * budget, whatever the user count — so two seconds would have been 30/min,
     * consuming the entire allowance on the price board alone and leaving
     * nothing for quotes, token lookups or the worker.
     *
     * Five seconds is 12/min, about 40% of the keyless budget, and leaves
     * room for everything else. It is also not slower in practice: the cache
     * only helps when callers land inside the same window, so a window
     * SHORTER than the client's poll interval buys nothing and spends the
     * allowance anyway.
     *
     * Nothing trades against this price — the worker fetches its own,
     * uncached, for exactly that reason.
     */
    const prices = await fetchPrices(mints, { revalidate: 5 });

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
