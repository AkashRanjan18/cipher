import { NextResponse } from "next/server";
import { buildRegistry } from "@/lib/market/build-registry";

/**
 * The token registry, rebuilt on a schedule rather than shipped frozen.
 *
 * public/tokens.json is a SEED — it is whatever the market looked like when
 * someone last ran the script, and its prices are stale the moment it is
 * committed. Names never go stale, so the seed is enough for the spelling
 * correction, but `readScale` compares a spoken number against a price and a
 * market cap, and that judgement drifts with the market.
 *
 * A cron cannot fix this: nothing can write to public/ on a deployed Vercel
 * build. So the fresh copy is a route with a cache window instead, and no
 * scheduler is involved at all — the first request after the window expires
 * pays for the rebuild and everyone else is served from the edge.
 *
 * AN HOUR, because the only thing here that has to be current is an ORDER OF
 * MAGNITUDE. readScale asks whether a number is nearer the price or the cap,
 * and those are separated by nine to twelve decades; an hour of drift does
 * not move that, and a token's name does not move at all.
 *
 * Three Jupiter calls per rebuild against an allowance of 60 a minute for the
 * whole deployment, so this costs 3/hour however many people are trading.
 */
export const revalidate = 3600;

export async function GET() {
  const registry = await buildRegistry(100);

  /*
   * A SHORT REGISTRY IS WORSE THAN A STALE ONE. If every feed failed, this is
   * the pinned majors and nothing else — and serving that for an hour would
   * un-resolve every memecoin on the platform. Fall through to the seed the
   * app shipped with instead, which is at least a whole market.
   */
  if (registry.tokens.length <= 16) {
    return NextResponse.json(registry, {
      status: 200,
      headers: { "cache-control": "public, max-age=0, s-maxage=60" },
    });
  }

  return NextResponse.json(registry, {
    headers: { "cache-control": `public, max-age=300, s-maxage=${revalidate}, stale-while-revalidate=86400` },
  });
}
