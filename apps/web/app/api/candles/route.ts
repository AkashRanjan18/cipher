import { NextResponse } from "next/server";
import { fetchCandles, isInterval, isMarket, SYMBOL } from "@/lib/market";

/**
 * Candles for one interval.
 *
 * The interval buttons are client-side, so switching has to refetch in the
 * browser. It goes through here rather than calling Binance directly so that
 * Next's cache absorbs the fan-out — a thousand users on the same interval is
 * one upstream request, not a thousand.
 */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const interval = params.get("interval") ?? "1h";
  const symbol = params.get("symbol") ?? SYMBOL;

  // Both validated against their allowlists rather than passed through: either
  // is interpolated straight into the upstream URL, and an unchecked symbol
  // turns this route into an open proxy onto any pair Binance quotes.
  if (!isInterval(interval)) {
    return NextResponse.json({ error: "bad interval" }, { status: 400 });
  }
  if (!isMarket(symbol)) {
    return NextResponse.json({ error: "unknown market" }, { status: 400 });
  }

  try {
    return NextResponse.json({ candles: await fetchCandles(interval, 1000, symbol) });
  } catch {
    return NextResponse.json({ error: "upstream unavailable" }, { status: 502 });
  }
}
