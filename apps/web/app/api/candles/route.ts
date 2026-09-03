import { NextResponse } from "next/server";
import { fetchCandles, isInterval } from "@/lib/market";

/**
 * Candles for one pool at one interval.
 *
 * The chart panel is a client component — switching from 1h to 5m has to
 * refetch in the browser. It calls here rather than GeckoTerminal directly
 * for three reasons:
 *
 *   1. the 30 req/min budget is per-IP, and upstream sees ONE ip (ours)
 *      instead of one per user, so Next's cache absorbs the fan-out
 *   2. users' IPs never reach a third party
 *   3. swapping to Birdeye later changes this file, not the client
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const pair = searchParams.get("pair");
  const interval = searchParams.get("interval") ?? "1h";

  if (!pair) {
    return NextResponse.json({ error: "pair required" }, { status: 400 });
  }
  /*
   * Validate against the union rather than passing the string through. An
   * unchecked value would be interpolated straight into the upstream URL.
   */
  if (!isInterval(interval)) {
    return NextResponse.json({ error: "bad interval" }, { status: 400 });
  }

  const candles = await fetchCandles(pair, interval, 300);
  return NextResponse.json({ candles });
}
