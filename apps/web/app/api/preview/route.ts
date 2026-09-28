import { NextResponse } from "next/server";
import { fetchPrices } from "@/lib/chain/prices";
import { preview } from "@/lib/chain/preview";
import { QuoteError } from "@/lib/chain/jupiter";

/**
 * What a trade is worth before it is placed. The work is in
 * lib/chain/preview.ts; this is input checking and a rate limit.
 *
 * PUBLIC, because a signed-out visitor trades paper money too and deserves
 * the same warning. Rate-limited per address, because every call spends a
 * quote from cipher's Jupiter allowance — the same allowance the worker's
 * stops draw on.
 *
 * cipher: in-memory limiter, per serverless instance. A shared store
 * (Upstash) when traffic makes the gap between instances matter.
 */

export const dynamic = "force-dynamic";

const LIMIT = 40;
const WINDOW_MS = 60_000;
const hits = new Map<string, number[]>();

function limited(key: string): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5_000) {
    for (const [k, v] of hits) if (v.every((t) => now - t > WINDOW_MS)) hits.delete(k);
  }
  return recent.length > LIMIT;
}

export async function GET(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "anon";
  if (limited(ip)) return NextResponse.json({ error: "too many requests" }, { status: 429 });

  const params = new URL(request.url).searchParams;
  const mint = params.get("mint")?.trim() ?? "";
  const side = params.get("side");
  const size = Number(params.get("size"));
  if (mint.length < 32 || mint.length > 44 || (side !== "buy" && side !== "sell") || !(size > 0)) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const priced = (await fetchPrices([mint], { revalidate: 5 })).get(mint);
  if (!priced || !(priced.usd > 0)) {
    return NextResponse.json({ error: "no price for that token" }, { status: 404 });
  }

  try {
    const p = await preview({ mint, decimals: priced.decimals, side, size, mark: priced.usd });
    return NextResponse.json({ preview: p, mark: priced.usd }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof QuoteError ? e.message : "no route right now" },
      { status: 502 },
    );
  }
}
