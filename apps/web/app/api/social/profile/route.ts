import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { hasDb } from "@/lib/db/client";
import { isFollowing, profileByHandle, publicTrades, statsOf } from "@/lib/social/profiles";

/**
 * Anyone's public profile, by handle. Public: a profile is meant to be shared.
 * Amounts are removed on the server when the owner hides them
 * (lib/social/profiles.ts), so a hidden number never reaches this response.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!hasDb()) return NextResponse.json({ error: "no database" }, { status: 503 });
  const handle = new URL(request.url).searchParams.get("handle")?.trim().toLowerCase() ?? "";
  if (!handle) return NextResponse.json({ error: "bad request" }, { status: 400 });

  const profile = await profileByHandle(handle);
  if (!profile) return NextResponse.json({ error: "not found" }, { status: 404 });

  const session = await getSession(request);
  const [stats, trades, following] = await Promise.all([
    statsOf(profile.userId, profile.hideAmounts),
    publicTrades(profile.userId, 50),
    session ? isFollowing(session.userId, profile.userId) : Promise.resolve(false),
  ]);

  /* Never the user id, the referral code or who referred them. */
  return NextResponse.json(
    {
      profile: { handle: profile.handle, displayName: profile.displayName, hideAmounts: profile.hideAmounts },
      stats,
      trades,
      following,
      mine: session?.userId === profile.userId,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
