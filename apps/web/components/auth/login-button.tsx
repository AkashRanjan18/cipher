"use client";

import { usePrivy, useLogin } from "@privy-io/react-auth";

/**
 * Opens Privy's modal, which renders the Apple and Google buttons from the
 * loginMethods array in app/providers/privy.tsx.
 *
 * Client component because it uses hooks. Kept as its own small file so
 * app/page.tsx can stay a server component — only this button needs to ship
 * JavaScript, not the whole landing page.
 */
export function LoginButton() {
  const { ready, authenticated } = usePrivy();
  const { login } = useLogin();

  // `ready` is false while Privy restores an existing session. Rendering
  // "Log in" during that window makes the button flash for returning users.
  if (!ready) {
    return <div className="h-9 w-20" aria-hidden />;
  }

  return (
    <button
      onClick={login}
      className="rounded-full border border-champagne/25 px-5 py-2 font-sans text-sm text-champagne/90 backdrop-blur-sm transition-colors hover:border-champagne/60 hover:text-champagne focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-champagne"
    >
      {authenticated ? "Enter" : "Log in"}
    </button>
  );
}
