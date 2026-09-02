"use client";

import { usePrivy, useLogin } from "@privy-io/react-auth";

/**
 * Opens Privy's modal, which renders the Apple and Google buttons from the
 * loginMethods array in app/providers/privy.tsx.
 *
 * Client component because it uses hooks. Kept as its own small file so
 * app/page.tsx can stay a server component — only this button ships
 * JavaScript, not the whole landing page.
 */
export function LoginButton() {
  const { ready, authenticated } = usePrivy();
  const { login } = useLogin();

  // Inlined at build time, so this is readable from a client component.
  const configured = Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID);

  // Without an app id Privy never becomes ready, so gating purely on `ready`
  // hides the button forever and the page looks like it has no login at all.
  // Distinguish "not configured yet" from "still restoring a session".
  if (configured && !ready) {
    // Reserve the exact footprint so nothing shifts when it resolves.
    return <div className="h-[38px] w-[86px]" aria-hidden />;
  }

  return (
    <button
      onClick={() => configured && login()}
      title={configured ? undefined : "Set NEXT_PUBLIC_PRIVY_APP_ID to enable"}
      className="rounded-full border border-champagne/25 px-5 py-2 font-sans text-sm text-champagne/90 backdrop-blur-sm transition-colors hover:border-champagne/60 hover:text-champagne focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-champagne"
    >
      {authenticated ? "Enter" : "Log in"}
    </button>
  );
}
