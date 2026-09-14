import { NextResponse } from "next/server";
import { discover, isFeed, launchRisks, type Feed } from "@/lib/chain/discover";
import type { Lifecycle } from "@/lib/chain/tokens";

/**
 * Every coin on Solana, at every stage of its life.
 *
 * Through the server rather than from the browser for the reason every Jupiter
 * call in cipher goes through the server: the allowance is 60 requests a
 * minute for the WHOLE deployment, not per user. A feed of new launches is the
 * same list for everyone looking at it, so one cached fetch serves all of them
 * — and without the cache the sixtieth user breaks it for the other 59.
 *
 *   /api/discover?feed=new                  what just launched
 *   /api/discover?feed=traded               24h volume leaders
 *   /api/discover?feed=organic              real activity, not wash trading
 *   /api/discover?feed=new&stage=bonding    still on the curve
 *   /api/discover?feed=traded&stage=graduated
 */

export const dynamic = "force-dynamic";

const STAGES: Lifecycle[] = ["bonding", "graduated", "legacy"];

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;

  const feed = q.get("feed") ?? "traded";
  if (!isFeed(feed)) {
    return NextResponse.json(
      { error: `unknown feed "${feed}" — use new, traded or organic` },
      { status: 400 },
    );
  }

  const stage = q.get("stage");
  if (stage && !STAGES.includes(stage as Lifecycle)) {
    return NextResponse.json(
      { error: `unknown stage "${stage}" — use bonding, graduated or legacy` },
      { status: 400 },
    );
  }

  const limit = Math.min(Math.max(Number(q.get("limit")) || 50, 1), 100);

  try {
    const tokens = await discover(feed as Feed, {
      ...(stage ? { lifecycle: stage as Lifecycle } : {}),
      limit,
      /* A launch feed is worth ten seconds. The volume leaders barely move in
         a minute, and spending the allowance to re-learn that is waste. */
      revalidate: feed === "new" ? 10 : 60,
    });

    return NextResponse.json({
      feed,
      stage: stage ?? "all",
      count: tokens.length,
      /*
       * The warnings ride along with the token rather than waiting for a
       * second call. A list of brand-new tokens where the dangerous ones look
       * exactly like the rest is worse than no list — and the user is deciding
       * from THIS response, not from one they might make later.
       */
      tokens: tokens.map((t) => ({ ...t, warnings: launchRisks(t) })),
    });
  } catch (e) {
    console.error("[cipher] discover failed:", e);
    return NextResponse.json({ error: "token feed unavailable" }, { status: 502 });
  }
}
