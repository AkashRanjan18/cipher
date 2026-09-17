"use client";

import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { AFTER_LOGIN, useLoginModal } from "./login-modal";

type Variant = "ghost" | "primary";

/**
 * Every button that opens Privy's modal.
 *
 * One component rather than one per placement, because the awkward part is
 * not the styling — it is knowing whether Privy is configured, whether it is
 * still restoring a session, and whether the user is already signed in. That
 * logic lives here once; `variant` only changes how it looks.
 *
 * Client component (hooks). Its own file so app/page.tsx stays a server
 * component and only these buttons ship JavaScript.
 */
export function AuthButton({
  variant = "ghost",
  label,
  className = "",
}: {
  variant?: Variant;
  label: string;
  /**
   * Extra classes, appended last so they win.
   *
   * The variants above are the shape this button takes everywhere; the landing
   * hero needs specific heights to sit right against the scene behind it, and
   * widening the variants for one page would resize the button in the header
   * too.
   */
  className?: string;
}) {
  const { ready, authenticated } = usePrivy();
  const { open } = useLoginModal();
  const router = useRouter();

  // Inlined at build time, so a client component can read it.
  const configured = Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID);

  const styles: Record<Variant, string> = {
    // Header. Recedes — it is for returning users, not the main path.
    ghost:
      "rounded-full border border-champagne/25 px-5 py-2 text-sm text-champagne/90 backdrop-blur-sm hover:border-champagne/60 hover:text-champagne",
    // Hero. The one action the page exists to produce.
    primary:
      "rounded-full bg-champagne px-8 py-3 text-sm font-medium text-ink hover:bg-white",
  };

  // Without an app id Privy never becomes ready, so gating on `ready` alone
  // hides the button forever and the page looks like it has no login at all.
  // Only reserve space when Privy is actually configured and loading.
  if (configured && !ready) {
    return (
      <div
        aria-hidden
        className={variant === "primary" ? "h-[46px] w-[150px]" : "h-[38px] w-[86px]"}
      />
    );
  }

  return (
    <button
      /*
       * Already signed in? Go. Do not ask again.
       *
       * This called open() unconditionally, so a signed-in visitor pressing
       * "Open cipher" got the login modal — asked to sign in to an account
       * they were already signed into, with no way through except the X.
       */
      onClick={() => (authenticated ? router.push(AFTER_LOGIN) : open())}
      className={`${styles[variant]} font-sans transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-champagne ${className}`}
    >
      {/*
        * THE LABEL NEVER CHANGES.
        *
        * These used to read "Enter" and "Open cipher" once you were signed in.
        * That is a third state nobody asked for: the homepage has two buttons,
        * they say what they do, and pressing either one gets you to the
        * terminal. Whether you happen to already have a session is cipher's
        * problem to solve silently, not a thing to rename a button over.
        */}
      {label}
    </button>
  );
}
