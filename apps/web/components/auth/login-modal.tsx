"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { usePrivy, useLoginWithOAuth } from "@privy-io/react-auth";
import { GoogleIcon } from "./google-icon";

/**
 * Our own login modal, replacing Privy's.
 *
 * Privy's built-in modal can be themed but not restructured. Its headless
 * initOAuth hook does the same work while leaving the markup to us, so the
 * sign-in screen looks like the product rather than like a vendor.
 *
 * Mounted once in app/layout.tsx. Any button anywhere calls open().
 */

const LoginModalContext = createContext<{ open: () => void }>({ open: () => {} });

export const useLoginModal = () => useContext(LoginModalContext);

/** Where a successful login lands. */
export const AFTER_LOGIN = "/trade";

/**
 * Set the instant before OAuth leaves the page, read the instant it returns.
 *
 * Google OAuth is a FULL PAGE REDIRECT, not a popup. Everything in React
 * memory is gone by the time the user comes back, so "did this person just log
 * in" cannot be answered from state — and the difference matters: someone who
 * just signed in wants the terminal, someone merely visiting the landing page
 * while already signed in wants to read it.
 *
 * sessionStorage rather than localStorage, so it dies with the tab and cannot
 * bounce a returning visitor days later.
 */
const PENDING = "cipher:login-pending";

export function LoginModalProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const { authenticated } = usePrivy();
  const router = useRouter();

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  /*
   * THE POST-LOGIN REDIRECT LIVES HERE, not in the modal.
   *
   * It used to be an effect inside Modal, which only runs while the modal is
   * MOUNTED — fine for a popup flow, useless for a redirect one. Google sends
   * the browser away and back, the modal is closed on return, the effect never
   * fires, and the user lands on the marketing page signed in with a button to
   * press. This provider is mounted in the root layout, so it is there to
   * catch the return.
   *
   * Guarded by the pending flag so it only ever fires for a login the user
   * just performed.
   */
  useEffect(() => {
    if (!authenticated) return;
    if (sessionStorage.getItem(PENDING) !== "1") return;
    sessionStorage.removeItem(PENDING);
    setIsOpen(false);
    router.replace(AFTER_LOGIN);
  }, [authenticated, router]);

  return (
    <LoginModalContext.Provider value={{ open }}>
      {children}
      {isOpen && <Modal onClose={close} />}
    </LoginModalContext.Provider>
  );
}

function Modal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { authenticated } = usePrivy();
  const { initOAuth, loading } = useLoginWithOAuth();
  const [error, setError] = useState<string | null>(null);

  // Inlined at build time. Without it Privy cannot start an OAuth flow, so
  // say that here rather than letting the buttons fail silently.
  const configured = Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID);

  // Escape closes. Expected of any dialog, and cheap.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Stop the page scrolling behind the modal.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  function guard() {
    if (!configured) {
      setError("Auth isn't connected yet — set NEXT_PUBLIC_PRIVY_APP_ID.");
      return false;
    }
    return true;
  }

  async function signInWithGoogle() {
    setError(null);
    if (!guard()) return;
    // Set BEFORE the redirect: after it, this code never runs again.
    sessionStorage.setItem(PENDING, "1");
    try {
      await initOAuth({ provider: "google" });
    } catch (e) {
      /*
       * The user gets one sentence; the console gets the real thing.
       *
       * "Couldn't reach Google" is a guess dressed as a diagnosis — the same
       * message covers a dead network, a login method that is not enabled on
       * the Privy app, and an origin that is not on its allowlist. Those need
       * three different fixes, and during setup the distinction is the whole
       * problem.
       */
      console.error("[cipher] Google sign-in failed:", e);
      // The redirect never happened, so the flag would sit there and bounce
      // an unrelated later visit.
      sessionStorage.removeItem(PENDING);
      setError("Couldn't reach Google. Try again.");
    }
  }


  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-md"
      onClick={onClose}
    >
      {/* Close sits outside the card, as in the reference — it reads as
          "leave this" rather than as another option inside the dialog. */}
      <button
        onClick={onClose}
        aria-label="Close"
        className="absolute right-5 top-5 flex h-12 w-12 items-center justify-center rounded-full bg-panel/90 text-2xl text-champagne transition-colors hover:bg-panel focus-visible:outline focus-visible:outline-2 focus-visible:outline-champagne"
      >
        &times;
      </button>

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Sign in to cipher"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-3xl border border-line bg-panel/80 p-8 shadow-2xl backdrop-blur-xl sm:p-10"
      >
        <p className="text-center font-display text-5xl lowercase text-champagne">
          cipher
        </p>

        <p className="mx-auto mt-4 max-w-[16rem] text-center font-sans text-lg leading-snug text-champagne/85">
          Login or create an account to start trading.
        </p>

        <div className="mt-8 space-y-3">
          {/* The only path. It provisions a wallet, needs no extension, and
              keeps signing silent — no popup on any trade. */}
          <button
            onClick={signInWithGoogle}
            disabled={loading}
            className="flex w-full items-center justify-center gap-3 rounded-2xl bg-white px-5 py-4 font-sans text-base font-medium text-black transition-opacity hover:opacity-90 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-champagne"
          >
            <GoogleIcon />
            Continue with Google
          </button>

        </div>

        {error && (
          <p role="alert" className="mt-4 text-center font-sans text-sm text-down">
            {error}
          </p>
        )}

        <p className="mt-7 text-center font-sans text-xs leading-relaxed text-ash">
          By signing up, you agree to our{" "}
          <a href="/legal/terms" className="underline hover:text-champagne">
            Terms of Service
          </a>{" "}
          and{" "}
          <a href="/legal/privacy" className="underline hover:text-champagne">
            Privacy Policy
          </a>
          .
        </p>
      </div>
    </div>
  );
}
