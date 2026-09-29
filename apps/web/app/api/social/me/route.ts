import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { hasDb } from "@/lib/db/client";
import { ensureUser } from "@/lib/db/accounts";
import { ensureProfile, referralSummary, statsOf, updateProfile } from "@/lib/social/profiles";

/**
 * Your own profile: read it (created on first read) and change it.
 * Logic in lib/social/profiles.ts; this is authorisation.
 */

export const dynamic = "force-dynamic";

async function signedIn(request: Request) {
  const session = await getSession(request);
  if (!session) return { error: NextResponse.json({ error: "not signed in" }, { status: 401 }) };
  if (!hasDb()) return { error: NextResponse.json({ error: "no database" }, { status: 503 }) };
  await ensureUser(session.userId);
  return { userId: session.userId };
}

export async function GET(request: Request) {
  const s = await signedIn(request);
  if ("error" in s) return s.error;
  const profile = await ensureProfile(s.userId);
  const [stats, referral] = await Promise.all([
    statsOf(s.userId, false),
    referralSummary(s.userId),
  ]);
  return NextResponse.json({ profile, stats, referral }, { headers: { "cache-control": "no-store" } });
}

export async function PATCH(request: Request) {
  const s = await signedIn(request);
  if ("error" in s) return s.error;
  let body: { handle?: unknown; displayName?: unknown; hideAmounts?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const result = await updateProfile(s.userId, {
    handle: typeof body.handle === "string" ? body.handle : undefined,
    displayName:
      typeof body.displayName === "string" ? body.displayName : body.displayName === null ? null : undefined,
    hideAmounts: typeof body.hideAmounts === "boolean" ? body.hideAmounts : undefined,
  });
  return NextResponse.json(result, { status: "error" in result ? 400 : 200 });
}
