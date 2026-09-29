import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { hasDb } from "@/lib/db/client";
import { ensureUser } from "@/lib/db/accounts";
import { setFollow } from "@/lib/social/profiles";

/** Follow or unfollow someone by handle. Logic in lib/social/profiles.ts. */

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await getSession(request);
  if (!session) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  if (!hasDb()) return NextResponse.json({ error: "no database" }, { status: 503 });
  let body: { handle?: unknown; follow?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  if (typeof body.handle !== "string" || typeof body.follow !== "boolean") {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  await ensureUser(session.userId);
  const result = await setFollow(session.userId, body.handle.toLowerCase(), body.follow);
  return NextResponse.json(result, { status: "error" in result ? 400 : 200 });
}
