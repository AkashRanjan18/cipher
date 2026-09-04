import { NextResponse } from "next/server";
import { fetchCandles, isInterval } from "@/lib/market";

/**
 * Candles for one interval.
 *
 * The interval buttons are client-side, so switching has to refetch in the
 * browser. It goes through here rather than calling Binance directly so that
 * Next's cache absorbs the fan-out — a thousand users on the same interval is
 * one upstream request, not a thousand.
 */
export async function GET(req: Request) {
  const interval = new URL(req.url).searchParams.get("interval") ?? "1h";

  // Validated against the union rather than passed through: an unchecked
  // value would be interpolated straight into the upstream URL.
  if (!isInterval(interval)) {
    return NextResponse.json({ error: "bad interval" }, { status: 400 });
  }

  try {
    return NextResponse.json({ candles: await fetchCandles(interval, 1000) });
  } catch {
    return NextResponse.json({ error: "upstream unavailable" }, { status: 502 });
  }
}
