"use client";

import { useCallback, useRef } from "react";
import { usePrivy } from "@privy-io/react-auth";

/**
 * A live Privy access token, asked for before every request.
 *
 * Reported live, 27 Sep 2026: "buy $4K of JUP" came back "Couldn't reach the
 * server". The server was fine; it answered 401. Both stores read the token
 * once at sign-in and reused it, and Privy's access tokens expire about an
 * hour after they are issued — so an hour into a session every trade, poll,
 * arm and cancel was refused as signed out (333 of them in two hours of
 * production logs). getAccessToken() returns the cached token while it is
 * valid and refreshes it when it is not, so asking every time costs nothing on
 * the normal path.
 *
 * NULL MEANS SIGNED OUT, and is passed on as null. Privy answers null when the
 * refresh token itself has expired or been revoked; sending the old JWT anyway
 * would only buy a guaranteed 401. A THROWN error is different — Privy could
 * not be reached — and there the last token is the best guess left.
 *
 * One hook for both stores (account and rules), so the policy lives once. The
 * returned function is stable: it reads getAccessToken through a ref, as
 * CLAUDE.md requires of anything handed to a stable callback.
 */
export function useLiveToken(): () => Promise<string | null> {
  const { getAccessToken } = usePrivy();
  const get = useRef(getAccessToken);
  get.current = getAccessToken;
  const last = useRef<string | null>(null);

  return useCallback(async () => {
    try {
      last.current = await get.current();
    } catch {
      /* Privy unreachable: fall back to the last token; the server will say. */
    }
    return last.current;
  }, []);
}
