"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { AFTER_LOGIN } from "./login-modal";

/**
 * The pass-through between Google and the terminal.
 *
 * Google's redirect comes back to "/" — Privy chooses that target and
 * initOAuth takes no redirectUrl — so the browser MUST load a cipher page
 * before anything can decide where the user really belongs. That load cannot
 * be skipped. What it can be is empty: app/page.tsx renders this instead of
 * the hero whenever the URL carries an OAuth code, so the marketing page is
 * never built on that pass and there is nothing on screen to read.
 *
 * Deliberately blank. A wordmark here turns a transition into a page, which is
 * the thing being fixed.
 */

/**
 * How long to wait for Privy before going anyway.
 *
 * THIS SCREEN MUST NOT BE ABLE TO DEAD-END, and two attempts at "leave when
 * the login reports success" both hung: useLoginWithOAuth's onComplete does
 * not fire on the return leg of a redirect, and `authenticated` has been
 * observed sitting false for more than ten seconds after a real sign-in —
 * Privy's login is documented to complete only after it has also CREATED THE
 * EMBEDDED WALLET, and Solana wallets are currently disabled on the app, so
 * that second half can never finish. A login that can never announce itself
 * is not something to wait on.
 *
 * So: go when Privy says so, and go anyway if it does not. /trade is public
 * and renders signed-out, the Privy provider lives in the root layout and
 * survives this navigation, and the header fills itself in when the session
 * lands. Worst case is a terminal that signs you in a moment late. Best case
 * — once the dashboard has Solana on — the timer never fires at all.
 *
 * Long enough that Privy has read the code off the URL on mount, which must
 * happen before the router drops the query string. Effects run child-first, so
 * this component's effect fires BEFORE the provider's; leaving immediately
 * would throw the code away.
 */
const GIVE_UP_MS = 1500;

export function SignInHandoff() {
  const { ready, authenticated } = usePrivy();
  const router = useRouter();

  /*
   * No "did they just log in" guard, unlike everywhere else in the app: this
   * component only exists because there is an OAuth code in the URL, which is
   * not a state anyone reaches by browsing.
   */
  useEffect(() => {
    if (ready && authenticated) router.replace(AFTER_LOGIN);
  }, [ready, authenticated, router]);

  useEffect(() => {
    const t = window.setTimeout(() => router.replace(AFTER_LOGIN), GIVE_UP_MS);
    return () => window.clearTimeout(t);
  }, [router]);

  return <div className="min-h-dvh bg-ink" />;
}
