"use client";

import { useEffect, useRef } from "react";
import { usePrivy, useUser } from "@privy-io/react-auth";

/**
 * Asks the server for a wallet, once, for anyone who does not have one.
 *
 * Renders nothing. Mounted in app/layout.tsx so it is present on every page a
 * user can be signed in on — which has to include "/", because that is where
 * Google's redirect lands.
 *
 * The work happens in app/api/wallet/route.ts; this only notices the gap and
 * knocks. See that file for why the wallet is not created automatically.
 */
export function EnsureWallet() {
  const { ready, authenticated, user, getAccessToken } = usePrivy();
  const { refreshUser } = useUser();

  /*
   * One attempt per user, per page load.
   *
   * A ref rather than state, because this must not cause a render, and it
   * holds the user id rather than a boolean so that signing out and into a
   * different account still provisions. Without it, refreshUser() below
   * changes `user`, the effect runs again, and it asks forever.
   */
  const asked = useRef<string | null>(null);

  useEffect(() => {
    if (!ready || !authenticated || !user) return;

    const hasSolana = user.linkedAccounts.some(
      (a) => a.type === "wallet" && a.chainType === "solana" && a.walletClientType === "privy",
    );
    if (hasSolana) return;

    if (asked.current === user.id) return;
    asked.current = user.id;

    void (async () => {
      try {
        /*
         * The token goes in a header, not left to the cookie.
         *
         * getAccessToken() returns the live one and refreshes it if it is
         * close to expiring, so this works on a tab that has been open for
         * hours. The route accepts the cookie too, but only this path is ours
         * to guarantee.
         */
        const token = await getAccessToken();
        const res = await fetch("/api/wallet", {
          method: "POST",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });

        if (!res.ok) {
          // Nothing is shown to the user. A missing wallet is not something
          // they asked for or can act on, and the account menu already says
          // plainly that there isn't one.
          console.error("[cipher] wallet provisioning failed:", res.status, await res.text());
          return;
        }

        /*
         * Privy's `user` is a client-side cache. The wallet now exists, and
         * without this the header would keep saying there is no wallet until
         * the next full page load — which reads exactly like the call failing.
         */
        await refreshUser();
      } catch (e) {
        console.error("[cipher] wallet provisioning failed:", e);
      }
    })();
  }, [ready, authenticated, user, getAccessToken, refreshUser]);

  return null;
}
