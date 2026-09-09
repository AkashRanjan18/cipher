import { NextResponse } from "next/server";
import { fetchDepth, isMarket, SYMBOL } from "@/lib/market";

/**
 * Book depth for one market.
 *
 * Its own route because it is per-symbol and changes when you pick a row,
 * unlike /api/majors which is the same response for everyone.
 */
export async function GET(req: Request) {
  const symbol = new URL(req.url).searchParams.get("symbol") ?? SYMBOL;

  // Allowlisted, not pattern matched — see the note in /api/candles.
  if (!isMarket(symbol)) {
    return NextResponse.json({ error: "unknown market" }, { status: 400 });
  }

  try {
    return NextResponse.json({ depthUsd: await fetchDepth(symbol) });
  } catch {
    return NextResponse.json({ error: "upstream unavailable" }, { status: 502 });
  }
}
