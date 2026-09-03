"use client";

import { usePrivy } from "@privy-io/react-auth";
import { PromptPanel } from "@/components/trade/prompt-panel";

/**
 * The trading screen.
 *
 * Deliberately NOT gated on authentication. Composing an order and reading
 * back what it will do costs nothing and commits nothing — gating that
 * behind a login is the friction the product exists to remove. Auth is
 * required to *arm* an order, which is the point where something real
 * happens, and the panel raises it there.
 *
 * Jurisdiction gating still applies via middleware.ts.
 */
export default function Trade() {
  const { ready, authenticated, user } = usePrivy();

  /*
   * Read the wallet off the user record rather than through useWallets()
   * from @privy-io/react-auth/solana. That hook depends on the external
   * wallet connector config, which went away with wallet login — calling it
   * now throws "Cannot read properties of null (reading 'connectors')".
   * The embedded wallet's address is already here.
   */
  const wallet = user?.linkedAccounts.find(
    (a) => a.type === "wallet" && a.chainType === "solana",
  );
  const address = wallet && "address" in wallet ? wallet.address : null;

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-8 px-6 py-16">
      <div className="flex flex-col gap-2">
        <p className="font-display text-4xl lowercase">
          {authenticated ? "you’re in." : "say what you want."}
        </p>

        {/* Only meaningful once signed in, so it stays out of the way until
            then rather than showing an empty row. */}
        {ready && authenticated && (
          <dl className="mt-2 space-y-2 font-mono text-xs">
            <div className="flex flex-wrap gap-x-4">
              <dt className="w-24 shrink-0 text-ash">signed in as</dt>
              <dd className="break-all text-champagne">
                {user?.google?.email ?? user?.email?.address ?? user?.id}
              </dd>
            </div>
            <div className="flex flex-wrap gap-x-4">
              <dt className="w-24 shrink-0 text-ash">wallet</dt>
              <dd className="break-all text-champagne">
                {address ?? "provisioning…"}
              </dd>
            </div>
          </dl>
        )}
      </div>

      <PromptPanel />
    </main>
  );
}
