import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { hasDb } from "@/lib/db/client";
import { feedFor } from "@/lib/social/profiles";

/** The trades of everyone you follow. Logic in lib/social/profiles.ts. */

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getSession(request);
  if (!session) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  if (!hasDb()) return NextResponse.json({ error: "no database" }, { status: 503 });
  const trades = await feedFor(session.userId, 50);
  return NextResponse.json({ trades }, { headers: { "cache-control": "no-store" } });
}
