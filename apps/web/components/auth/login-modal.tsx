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
import { usePrivy, useLoginWithOAuth, useConnectWallet } from "@privy-io/react-auth";
import { GoogleIcon } from "./google-icon";
import { WalletIcon } from "./wallet-icon";

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
const AFTER_LOGIN = "/trade";

export function LoginModalProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

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
  const { connectWallet } = useConnectWallet();
  const [error, setError] = useState<string | null>(null);

  // Inlined at build time. Without it Privy cannot start an OAuth flow, so
  // say that here rather than letting the buttons fail silently.
  const configured = Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID);

  /*
   * The redirect lives here rather than in the provider on purpose. If it
   * watched `authenticated` globally, an already-signed-in visitor landing on
   * the marketing page would be bounced to /trade before they could read it.
   * Mounted only while the modal is open, it fires solely for a login the
   * user just performed.
   */
  useEffect(() => {
    if (authenticated) {
      onClose();
      router.push(AFTER_LOGIN);
    }
  }, [authenticated, onClose, router]);

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
    try {
      await initOAuth({ provider: "google" });
    } catch {
      setError("Couldn't reach Google. Try again.");
    }
  }

  /*
   * Opens Privy's wallet picker — Phantom, Solflare, Backpack, whatever is
   * installed. A user arriving this way keeps their own wallet and gets no
   * embedded one, which is the point: they already hold funds.
   *
   * The cost is that every signature afterwards raises their wallet's own
   * popup, which we cannot silence the way we silence the embedded wallet.
   * That only goes away once they grant delegate authority.
   */
  function signInWithWallet() {
    setError(null);
    if (!guard()) return;
    connectWallet();
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
        className="absolute right-5 top-5 flex h-12 w-12 items-center justify-center rounded-full bg-slate/90 text-2xl text-champagne transition-colors hover:bg-slate focus-visible:outline focus-visible:outline-2 focus-visible:outline-champagne"
      >
        &times;
      </button>

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Sign in to cipher"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-3xl border border-champagne/12 bg-slate/80 p-8 shadow-2xl backdrop-blur-xl sm:p-10"
      >
        <p className="text-center font-display text-5xl lowercase text-champagne">
          cipher
        </p>

        <p className="mx-auto mt-4 max-w-[16rem] text-center font-sans text-lg leading-snug text-champagne/85">
          Login or create an account to start trading.
        </p>

        <div className="mt-8 space-y-3">
          {/* Google is primary and filled: it is the path that provisions a
              wallet, needs no extension, and keeps signing silent. */}
          <button
            onClick={signInWithGoogle}
            disabled={loading}
            className="flex w-full items-center justify-center gap-3 rounded-2xl bg-white px-5 py-4 font-sans text-base font-medium text-black transition-opacity hover:opacity-90 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-champagne"
          >
            <GoogleIcon />
            Continue with Google
          </button>

          {/* Wallet is secondary and outlined — for people who already hold
              funds somewhere and would rather not move them. */}
          <button
            onClick={signInWithWallet}
            disabled={loading}
            className="flex w-full items-center justify-center gap-3 rounded-2xl border border-champagne/15 bg-ink/60 px-5 py-4 font-sans text-base font-medium text-champagne transition-colors hover:bg-ink disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-champagne"
          >
            <WalletIcon />
            Continue with a wallet
          </button>
        </div>

        {error && (
          <p role="alert" className="mt-4 text-center font-sans text-sm text-red-400">
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
