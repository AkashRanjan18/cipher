import { NextResponse } from "next/server";
import { fetchMajors } from "@/lib/market";

/**
 * Prices for every row in the left panel and the bottom ticker.
 *
 * Its own route rather than a field on /api/candles, because the two have
 * completely different lifetimes: candles change when you pick an interval,
 * this changes every few seconds for everybody at once. Bundling them would
 * refetch a thousand bars every time a price ticked.
 *
 * Goes through the server for the same reason candles do — Next's cache
 * absorbs the fan-out, so a thousand open terminals are one upstream request
 * rather than a thousand, which is the difference between staying inside
 * Binance's rate limit and being banned by it.
 */
export async function GET() {
  try {
    return NextResponse.json({ majors: await fetchMajors() });
  } catch {
    return NextResponse.json({ error: "upstream unavailable" }, { status: 502 });
  }
}
