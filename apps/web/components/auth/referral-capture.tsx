"use client";

import { useEffect } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useLiveToken } from "@/lib/auth/use-live-token";
import { redeemReferral } from "@/lib/social/client";

const KEY = "cipher:ref";

/**
 * Remembers a ?ref= code from the link someone arrived by, and applies it
 * once they sign in. Renders nothing.
 *
 * Remembered in localStorage because the link and the sign-in are rarely the
 * same page load: a new visitor lands on /?ref=abc, looks around, and signs in
 * three pages later. Applied once, then forgotten, whatever the answer — the
 * server's rules (once, not your own, before the first trade) decide, and a
 * code that failed would fail the same way on every retry.
 */
export function ReferralCapture() {
  const { ready, authenticated } = usePrivy();
  const liveToken = useLiveToken();

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("ref");
    if (code && /^[a-z0-9]{4,32}$/i.test(code)) {
      try {
        window.localStorage.setItem(KEY, code.toLowerCase());
      } catch {
        /* Storage blocked: the code only lives for this page load. */
      }
    }
  }, []);

  useEffect(() => {
    if (!ready || !authenticated) return;
    let code: string | null = null;
    try {
      code = window.localStorage.getItem(KEY);
    } catch {
      code = new URLSearchParams(window.location.search).get("ref");
    }
    if (!code) return;
    void liveToken().then(async (token) => {
      if (!token) return;
      await redeemReferral(token, code!);
      try {
        window.localStorage.removeItem(KEY);
      } catch {
        /* Nothing to forget. */
      }
    });
  }, [ready, authenticated, liveToken]);

  return null;
}
