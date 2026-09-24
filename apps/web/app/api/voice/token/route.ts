import { NextResponse } from "next/server";
import { mintVoiceToken, TokenError } from "@/lib/voice/token";

/**
 * Issue a sixty-second Deepgram pass for the browser's voice socket.
 *
 * A guard around lib/voice/token.ts and nothing more — the reasoning for why
 * the browser needs a pass at all lives there, where it can be tested.
 *
 * cipher: no session required, matching /api/transcribe, because voice works
 * for signed-out paper accounts and requiring sign-in is a product decision
 * rather than a fix. The exposure is the same as that route's today: anyone
 * who finds this can stream audio on the account's credit, sixty seconds per
 * pass, at $0.0077 a minute. Put a per-IP limit in front of both before the
 * credit is real money rather than a signup grant.
 */

export const dynamic = "force-dynamic";
/* The edge, like the transcribe route: this is on the path between pressing
   Ctrl and the socket opening, and a Virginia cold start is time the user is
   already talking through. */
export const runtime = "edge";

export async function GET() {
  const key = process.env.DEEPGRAM_MINT_KEY;
  if (!key) {
    return NextResponse.json({ error: "voice streaming not configured" }, { status: 503 });
  }

  try {
    const token = await mintVoiceToken(key);
    return NextResponse.json(token, {
      /* Never cached anywhere. A pass that a CDN handed to the next visitor
         would let a stranger stream on this account for the rest of its life. */
      headers: { "cache-control": "no-store, max-age=0" },
    });
  } catch (e) {
    const status = e instanceof TokenError ? e.status : 502;
    const message = e instanceof Error ? e.message : "voice token failed";
    return NextResponse.json({ error: message }, { status });
  }
}
