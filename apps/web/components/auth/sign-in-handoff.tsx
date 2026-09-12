"use client";

import { useEffect, useState } from "react";

/**
 * What the browser shows between Google and the terminal.
 *
 * Google's OAuth redirect comes back to "/" — that target is Privy's to
 * choose, not ours, and initOAuth takes no redirectUrl. So the marketing page
 * IS the landing page for a returning sign-in, and it painted in full: the
 * hero, the wordmark, "Start trading", a whole page the user had already left.
 * Then a beat later the redirect to /trade fired and it vanished. Four pages
 * in a flow that should have three.
 *
 * app/page.tsx renders this INSTEAD of the hero whenever the URL carries an
 * OAuth code, so the homepage is never built on that pass. Nothing here does
 * any work — LoginModalProvider owns the exchange and the routing. This is
 * only the ground the browser stands on while that happens.
 */
export function SignInHandoff() {
  /*
   * The one thing this screen must not do is trap someone.
   *
   * If the exchange fails, LoginModalProvider logs it and sets an error on a
   * modal that is closed, so nothing reaches the screen and a blank ground
   * stays blank. Ten seconds is far longer than the handoff has ever taken;
   * past that, something is wrong and there needs to be a way out.
   */
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setStalled(true), 10_000);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-ink px-6 text-center">
      {/* The wordmark, on the ground both the homepage and the terminal use,
          so this reads as one screen becoming another rather than as a page. */}
      <span className="font-display text-6xl lowercase text-champagne">cipher</span>

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
