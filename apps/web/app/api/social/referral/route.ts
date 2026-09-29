import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { hasDb } from "@/lib/db/client";
import { ensureUser } from "@/lib/db/accounts";
import { applyReferral } from "@/lib/social/profiles";

/**
 * Join under someone's referral code. The rules (once, not your own, before
 * the first trade) are in lib/social/profiles.ts.
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await getSession(request);
  if (!session) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  if (!hasDb()) return NextResponse.json({ error: "no database" }, { status: 503 });
  let body: { code?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  if (typeof body.code !== "string" || body.code.length > 32) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  await ensureUser(session.userId);
  const result = await applyReferral(session.userId, body.code);
  return NextResponse.json(result, { status: "error" in result ? 400 : 200 });
}
