import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { hasDb } from "@/lib/db/client";
import { everyoneFeed, feedFor } from "@/lib/social/profiles";

/**
 * The feed. Logic in lib/social/profiles.ts.
 *
 *   ?scope=everyone   everyone's public trades. No sign-in needed — it shows
 *                     nothing a profile page does not already show anyone.
 *   (default)         the trades of the people you follow. Needs to know you.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!hasDb()) return NextResponse.json({ error: "no database" }, { status: 503 });
  const everyone = new URL(request.url).searchParams.get("scope") === "everyone";
  const session = await getSession(request);
  if (!everyone && !session) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const trades = everyone
    ? await everyoneFeed(50, session?.userId ?? null)
    : await feedFor(session!.userId, 50);
  return NextResponse.json({ trades }, { headers: { "cache-control": "no-store" } });
}
