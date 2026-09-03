import { NextResponse } from "next/server";
import { fetchTrades } from "@/lib/market";

/**
 * The tape for one pool. Polled by the client every few seconds.
 *
 * Same reasoning as /api/candles: one upstream IP, Next's cache in front of
 * it, and the provider swappable without touching a component.
 */
export async function GET(req: Request) {
  const pair = new URL(req.url).searchParams.get("pair");
  if (!pair) {
    return NextResponse.json({ error: "pair required" }, { status: 400 });
  }

  const trades = await fetchTrades(pair);
  return NextResponse.json({ trades });
}
