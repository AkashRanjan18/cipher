import { NextResponse } from "next/server";
import { fetchTokenStats } from "@/lib/market";

/**
 * Live stats for one token. Polled by the terminal so the header ticks.
 *
 * Same reasoning as the other market routes: one upstream IP, Next's cache
 * in front of it, provider swappable without touching a component.
 */
export async function GET(req: Request) {
  const mint = new URL(req.url).searchParams.get("mint");
  if (!mint) {
    return NextResponse.json({ error: "mint required" }, { status: 400 });
  }

  const stats = await fetchTokenStats(mint);
  if (!stats) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json({ stats });
}
