"use client";

import { PrivyProvider, type PrivyClientConfig } from "@privy-io/react-auth";
import { toSolanaWalletConnectors } from "@privy-io/react-auth/solana";
import type { ReactNode } from "react";

/*
 * Connectors are built once at module scope, not inside the component.
 * Rebuilding them on every render remounts the wallet adapters and drops
 * an in-flight connection.
 */
const solanaConnectors = toSolanaWalletConnectors();

const config: PrivyClientConfig = {
  /*
   * We render our own modal (components/auth/login-modal.tsx) and drive login
   * through headless hooks, so Privy's UI never appears. This array only
   * declares which methods the SDK may use.
   *
   * Apple is absent: Sign in with Apple needs a Team ID, Service ID, Key ID
   * and signing key, all of which require a paid Apple Developer account,
   * which requires a legal entity. It slots back in with no UI change.
   */
  loginMethods: ["google", "wallet"],

  externalWallets: {
    solana: { connectors: solanaConnectors },
  },

  embeddedWallets: {
    /*
     * We render our own confirmation — the readback contract, stated in the
     * user's own words. Privy's transaction prompt on top would be two
     * confirmations for one decision, and the weaker of the two would be the
     * one asking.
     *
     * NOTE: this only silences the EMBEDDED wallet. A user who signed in with
     * Phantom still gets Phantom's own popup on every signature, because that
     * wallet is not ours to quiet. That gap closes only once they grant
     * delegate authority.
     */
    showWalletUIs: false,

    /*
     * "users-without-wallets" means someone arriving with Phantom keeps
     * Phantom and gets no embedded wallet. That is the intent — provisioning a
     * second, empty wallet for someone who already holds funds elsewhere is
     * how you make a user transfer money before they can do anything.
     */
    solana: { createOnLogin: "users-without-wallets" },
    ethereum: { createOnLogin: "off" },
  },

  appearance: {
    theme: "dark",
    accentColor: "#f3e9d8",
  },
};

export function Privy({ children }: { children: ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

  // Privy throws on mount without an app id and takes the whole tree with it.
  // The landing page must render for a visitor who has never signed in — and
  // for us, before the Privy account exists — so degrade instead.
  if (!appId) return <>{children}</>;

  return (
    <PrivyProvider appId={appId} config={config}>
      {children}
    </PrivyProvider>
  );
}
