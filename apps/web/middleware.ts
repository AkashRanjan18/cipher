import { NextResponse, type NextRequest } from "next/server";
import { gate, isOpenPath, readGeo } from "@/lib/geo/restricted";

/**
 * Jurisdiction gate.
 *
 * Runs before every request. Open paths (landing, scanner, share cards) pass
 * through from anywhere. Sanctioned jurisdictions are blocked on everything
 * else. US persons are blocked only from perps and event markets — spot is
 * non-custodial and open to them.
 *
 * Fails closed in production and open in development, because locally no CDN
 * sets geo headers and every request would otherwise read as unknown origin.
 */
export function middleware(req: NextRequest) {
  if (isOpenPath(req.nextUrl.pathname)) return NextResponse.next();

  const decision = gate(
    readGeo(req.headers),
    req.nextUrl.pathname,
    process.env.NODE_ENV === "production",
  );
  if (decision.allow) return NextResponse.next();

  // APIs get a status code, not a redirect. 451 is the correct one: the
  // resource exists and is being withheld for legal reasons.
  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "unavailable_in_your_jurisdiction", reason: decision.reason },
      { status: 451 },
    );
  }

  const url = req.nextUrl.clone();
  url.pathname = "/restricted";
  url.searchParams.set("reason", decision.reason);
  return NextResponse.redirect(url);
}

export const config = {
  // Skip static assets outright — cheaper than routing them through the gate.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\.(?:png|jpg|svg|webp|woff2)$).*)"],
};
