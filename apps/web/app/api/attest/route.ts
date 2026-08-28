import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";

/**
 * Record a jurisdiction attestation.
 *
 * Set as an httpOnly cookie so the client cannot forge it, and tied to the
 * verified Privy user id rather than anything the caller sent.
 *
 * TODO(phase 1): this also needs a row in Postgres — user id, timestamp, IP
 * country as we saw it, and the exact wording shown. A cookie is a UX
 * convenience; the audit record is the thing that matters if anyone ever asks
 * whether we knowingly served a restricted market.
 */
export async function POST() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set("cipher-attested", session.userId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return res;
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ attested: false });

  const { cookies } = await import("next/headers");
  const value = (await cookies()).get("cipher-attested")?.value;
  return NextResponse.json({ attested: value === session.userId });
}
