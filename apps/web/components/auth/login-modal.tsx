"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useLoginWithOAuth } from "@privy-io/react-auth";
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

type LoginModal = {
  /** Show the dialog. */
  open: () => void;
  /**
   * Start the Google flow. On the context rather than in the dialog, so the
   * provider's hook is the only one in the app — see the note below.
   */
  signInWithGoogle: () => Promise<void>;
  loading: boolean;
  error: string | null;
};

const LoginModalContext = createContext<LoginModal>({
  open: () => {},
  signInWithGoogle: async () => {},
  loading: false,
  error: null,
});

export const useLoginModal = () => useContext(LoginModalContext);

/** Where a successful login lands. */
export const AFTER_LOGIN = "/trade";

/**
 * THE OAUTH HOOK LIVES HERE, not in the modal, and that is load-bearing.
 *
 * Google OAuth is a FULL PAGE REDIRECT. Everything in React memory is gone by
 * the time the browser returns, and it returns to a page where the dialog is
 * closed and therefore unmounted — so a hook that exists only inside the
 * dialog is not there to finish what the dialog started. This provider is
 * mounted in the root layout, which means it is mounted on every page the
 * redirect could land on.
 *
 * IT DOES NOT OWN THE POST-LOGIN REDIRECT. That was tried through this hook's
 * onComplete, which is documented to fire on the return leg and does not seem
 * to after a full page redirect — the user landed and simply stayed there.
 * SignInHandoff watches `authenticated` instead, which is the signal actually
 * observed changing on that page. One mechanism, in the file named for the job.
 */
export function LoginModalProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Inlined at build time. Without it Privy cannot start an OAuth flow, so
  // say so rather than letting the button fail silently.
  const configured = Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID);

  const { initOAuth, loading } = useLoginWithOAuth({
    onError: (code) => {
      /*
       * Nearly invisible by construction: this fires after the redirect, when
       * the dialog is closed, so there is nowhere on screen to put it. The
       * console is the honest channel, Privy draws its own failure card, and
       * SignInHandoff carries the user's way out after ten seconds.
       */
      console.error("[cipher] Google sign-in failed after redirect:", code);
      setError("Couldn't finish signing in. Try again.");
    },
  });

  const open = useCallback(() => {
    setError(null);
    setIsOpen(true);
  }, []);
  const close = useCallback(() => setIsOpen(false), []);

  const signInWithGoogle = useCallback(async () => {
    setError(null);
    if (!configured) {
      setError("Auth isn't connected yet — set NEXT_PUBLIC_PRIVY_APP_ID.");
      return;
    }
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
      setError("Couldn't reach Google. Try again.");
    }
  }, [configured, initOAuth]);

  return (
    <LoginModalContext.Provider value={{ open, signInWithGoogle, loading, error }}>
      {children}
      {isOpen && <Modal onClose={close} />}
    </LoginModalContext.Provider>
  );
}

function Modal({ onClose }: { onClose: () => void }) {
  // Markup only. The flow, its loading state and its errors belong to the
  // provider, because they outlive this component by a full page navigation.
  const { signInWithGoogle, loading, error } = useLoginModal();

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
