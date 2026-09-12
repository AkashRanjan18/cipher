"use client";

import { useEffect, useState } from "react";
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
 * Deliberately blank. A wordmark here turns a transition into a page, which
 * is the thing being fixed.
 *
 * THE REDIRECT LIVES HERE, and it watches `authenticated` rather than a
 * callback. useLoginWithOAuth's onComplete is documented to fire on the return
 * leg and does not appear to after a full page redirect — the browser lands,
 * Privy exchanges the code, `authenticated` flips true, and onComplete never
 * runs. `authenticated` is the signal we have actually observed changing on
 * this page, so it is the one to act on.
 *
 * No "did they just log in" guard is needed, unlike everywhere else in the
 * app: this component only exists because there is an OAuth code in the URL,
 * which is not a state anyone reaches by browsing.
 */
export function SignInHandoff() {
  const { ready, authenticated } = usePrivy();
  const router = useRouter();

  useEffect(() => {
    if (ready && authenticated) router.replace(AFTER_LOGIN);
  }, [ready, authenticated, router]);

  /*
   * The one thing this screen must not do is trap someone.
   *
   * If the exchange fails there is no dialog open to show the error in, and a
   * blank ground stays blank. Ten seconds is far longer than the handoff has
   * ever taken; past that, something is wrong and there needs to be a way out.
   */
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setStalled(true), 10_000);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-ink px-6 text-center">
      {stalled && (
        <p className="max-w-sm font-sans text-sm leading-relaxed text-ash">
          This is taking longer than it should.{" "}
          <a href="/" className="text-champagne underline">
            Go back and try again
          </a>
          .
        </p>
      )}
    </div>
  );
}
