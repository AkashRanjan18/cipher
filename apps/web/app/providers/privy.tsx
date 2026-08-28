"use client";

import { PrivyProvider, type PrivyClientConfig } from "@privy-io/react-auth";
import type { ReactNode } from "react";

/**
 * Identity for cipher.
 *
 * Deliberate choices, each of which is a decision rather than a default:
 *
 * - No SMS login. Phone auth is the SIM-swap attack surface, and an account
 *   that can sign transactions should not hang off a number a carrier can
 *   reassign to someone who called them.
 * - Solana embedded wallet provisioned on login, invisibly. No seed phrase is
 *   ever shown, because a seed phrase shown is a seed phrase screenshotted.
 * - Keys stay exportable. Non-custodial has to be true in practice, not just
 *   in the marketing, and export is what makes it checkable.
 */
const config: PrivyClientConfig = {
  loginMethods: ["apple", "google", "twitter", "email"],

  embeddedWallets: {
    solana: { createOnLogin: "users-without-wallets" },
    // No EVM wallet until the Hyperliquid leg, which needs one for EIP-712.
    ethereum: { createOnLogin: "off" },
  },

  appearance: {
    theme: "dark",
    accentColor: "#e2a445",
    landingHeader: "Continue",
    loginMessage: "One tap. Wallet included.",
    showWalletLoginFirst: false,
  },
};

export function Privy({ children }: { children: ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

  // Without an app id Privy throws on mount and takes the whole tree with it.
  // The scanner is public and must keep working, so degrade instead: render
  // the app unauthenticated rather than showing a blank page.
  if (!appId) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "[cipher] NEXT_PUBLIC_PRIVY_APP_ID is unset — auth disabled, scanner still works.",
      );
    }
    return <>{children}</>;
  }

  return (
    <PrivyProvider appId={appId} config={config}>
      {children}
    </PrivyProvider>
  );
}
