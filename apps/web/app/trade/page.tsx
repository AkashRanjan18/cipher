"use client";

import { usePrivy } from "@privy-io/react-auth";

/**
 * PLACEHOLDER. Where login lands, so the redirect has a real destination.
 *
 * This is not the trading screen — it exists only to close the loop from
 * "Start trading" through Google to somewhere that isn't a 404. It shows the
 * wallet address so you can confirm the whole chain worked: sign in, wallet
 * provisioned, session verified.
 *
 * Gated by middleware.ts, which blocks restricted jurisdictions on any path
 * outside the open list.
 */
export default function Trade() {
  const { ready, authenticated, user } = usePrivy();

  /*
   * Read the wallet off the user record rather than through
   * useWallets() from @privy-io/react-auth/solana.
   *
   * That hook depends on the external-wallet connector config, which was
   * removed when wallet login went away — calling it now throws
   * "Cannot read properties of null (reading 'connectors')". It exists to
   * manage connections to Phantom and friends, and we have none: every user
   * gets an embedded wallet, and its address is already on the user object.
   */
  const wallet = user?.linkedAccounts.find(
    (a) => a.type === "wallet" && a.chainType === "solana",
  );
  const address = wallet && "address" in wallet ? wallet.address : null;

  if (!ready) {
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <p className="font-sans text-sm text-ash">Loading…</p>
      </main>
    );
  }

  if (!authenticated) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="font-display text-2xl">You&rsquo;re signed out.</p>
        <a
          href="/"
          className="font-sans text-sm text-ash underline hover:text-champagne"
        >
          Back to the homepage
        </a>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-6 px-6">
      <p className="font-display text-4xl lowercase">you&rsquo;re in.</p>

      <dl className="space-y-3 font-mono text-sm">
        <div className="flex flex-wrap gap-x-4">
          <dt className="w-28 shrink-0 text-ash">signed in as</dt>
          <dd className="break-all text-champagne">
            {user?.google?.email ?? user?.email?.address ?? user?.id}
          </dd>
        </div>
        <div className="flex flex-wrap gap-x-4">
          <dt className="w-28 shrink-0 text-ash">solana wallet</dt>
          <dd className="break-all text-champagne">
            {address ?? "provisioning…"}
          </dd>
        </div>
      </dl>

      <p className="font-sans text-sm text-ash">
        Placeholder. The trading screen goes here.
      </p>
    </main>
  );
}
