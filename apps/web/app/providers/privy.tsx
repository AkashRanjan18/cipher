"use client";

import { PrivyProvider, type PrivyClientConfig } from "@privy-io/react-auth";
import type { ReactNode } from "react";

const config: PrivyClientConfig = {
  // Two options only, as specified. Privy renders the modal; this array is
  // what decides which buttons appear in it and in what order.
  loginMethods: ["apple", "google"],

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
