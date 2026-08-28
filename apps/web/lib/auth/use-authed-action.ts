"use client";

import { usePrivy, useLogin } from "@privy-io/react-auth";
import { useCallback, useRef } from "react";

/**
 * Contextual auth.
 *
 * fomo's claim is "onboard, fund, and buy a token within 30 seconds", and that
 * is only possible because signing in is not a gate you pass before browsing —
 * it is triggered by intent and the intent survives it.
 *
 * A user taps buy, auth happens, and the buy they were attempting completes on
 * the other side. They never experience "sign in, then find your way back to
 * what you were doing", which is where conventional flows lose people.
 *
 *   const run = useAuthedAction();
 *   <button onClick={() => run(() => buy(mint, 500))}>Buy</button>
 *
 * Signed in: the action fires immediately.
 * Signed out: Privy's modal opens, and the action fires once it closes.
 */
export function useAuthedAction() {
  const { ready, authenticated } = usePrivy();
  const pending = useRef<(() => void | Promise<void>) | null>(null);

  const { login } = useLogin({
    onComplete: () => {
      const action = pending.current;
      pending.current = null;
      void action?.();
    },
    onError: () => {
      // Abandoned or failed login. Drop the intent rather than replaying it
      // the next time this component happens to authenticate.
      pending.current = null;
    },
  });

  return useCallback(
    (action: () => void | Promise<void>) => {
      if (!ready) return;
      if (authenticated) {
        void action();
        return;
      }
      pending.current = action;
      login();
    },
    [ready, authenticated, login],
  );
}
