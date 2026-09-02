"use client";

import { PrivyProvider, type PrivyClientConfig } from "@privy-io/react-auth";
import type { ReactNode } from "react";

const config: PrivyClientConfig = {
  // We render our own modal (components/auth/login-modal.tsx), so this array
  // only declares which methods the SDK may use — Privy's own UI is never
  // shown. Apple is absent because Sign in with Apple needs a Team ID,
  // Service ID, Key ID and signing key, all of which require a paid Apple
  // Developer account, which requires a legal entity. It slots back in here
  // with no UI change once that exists.
  loginMethods: ["google", "email"],

  embeddedWallets: {
    showWalletUIs: false,
    solana: { createOnLogin: "users-without-wallets" },
    ethereum: { createOnLogin: "off" },
  },

  appearance: {
    theme: "dark",
    accentColor: "#f3e9d8",
    landingHeader: "Continue",
    loginMessage: "One tap. Wallet included, no seed phrase.",
  },
};

export function Privy({ children }: { children: ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

  // Privy throws on mount without an app id and takes the whole tree with it.
  // The landing page must render for a visitor who has never signed in, so
  // degrade to unauthenticated rather than showing a blank screen.
  if (!appId) return <>{children}</>;

  return (
    <PrivyProvider appId={appId} config={config}>
      {children}
    </PrivyProvider>
  );
}
