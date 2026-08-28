"use client";

import { usePrivy, useLogout } from "@privy-io/react-auth";
import { useWallets, useExportWallet } from "@privy-io/react-auth/solana";
import { useState } from "react";
import { useAuthedAction } from "@/lib/auth/use-authed-action";

/** Middle-truncate an address. Four each side is enough to recognise your own. */
function short(addr: string) {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

/**
 * The account chip in the header.
 *
 * Deliberately secondary. The primary way into cipher is any action button —
 * tap buy, auth happens, the buy completes (see useAuthedAction). This is here
 * for people who want to sign in before doing anything, which is a minority,
 * and for showing the wallet once they have.
 */
export function SignIn() {
  const { ready, authenticated } = usePrivy();
  const run = useAuthedAction();

  // `ready` is false while the session is restored. Rendering a signed-out
  // state here makes the header flicker on every reload for returning users.
  if (!ready) {
    return <div className="h-8 w-24 animate-pulse rounded bg-neutral-800" aria-hidden />;
  }

  if (!authenticated) {
    return (
      <button
        onClick={() => run(() => {})}
        className="rounded border border-neutral-800 px-3 py-1.5 text-sm text-neutral-300 transition-colors hover:border-neutral-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500"
      >
        Sign in
      </button>
    );
  }

  return <Account />;
}

function Account() {
  const { logout } = useLogout();
  const { wallets } = useWallets();
  const { exportWallet } = useExportWallet();
  const [copied, setCopied] = useState(false);

  const wallet = wallets[0];

  async function copy() {
    if (!wallet) return;
    await navigator.clipboard.writeText(wallet.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="flex items-center gap-3">
      {wallet ? (
        <button
          onClick={copy}
          title={wallet.address}
          className="rounded border border-neutral-800 px-3 py-1.5 font-mono text-xs text-neutral-300 transition-colors hover:border-neutral-600 focus-visible:outline focus-visible:outline-2"
        >
          {copied ? "copied" : short(wallet.address)}
        </button>
      ) : (
        <span className="font-mono text-xs text-neutral-500">
          provisioning wallet…
        </span>
      )}

      {/* Export is what makes "non-custodial" checkable rather than claimed.
          It stays visible, not buried three levels into settings. */}
      {wallet && (
        <button
          onClick={() => exportWallet({ address: wallet.address })}
          className="font-mono text-xs text-neutral-500 underline-offset-2 hover:text-neutral-300 hover:underline focus-visible:outline focus-visible:outline-2"
        >
          export key
        </button>
      )}

      <button
        onClick={logout}
        className="font-mono text-xs text-neutral-500 underline-offset-2 hover:text-neutral-300 hover:underline focus-visible:outline focus-visible:outline-2"
      >
        sign out
      </button>
    </div>
  );
}
