"use client";

import { useEffect, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";

/**
 * Who you are, and the way out.
 *
 * The terminal header carried a hardcoded "AR" disc for weeks — a placeholder
 * that looked exactly like a working account menu, which is the worst kind. It
 * did not know who was signed in, never showed the wallet, and there was no
 * sign-out anywhere in the product: once you were in, the only way out was
 * clearing site data.
 *
 * THE ADDRESS COMES FROM user.linkedAccounts, NOT from the Solana hooks.
 * Importing @privy-io/react-auth/solana drags in four optional peers Privy
 * does not install, npm resolves them to mutually incompatible versions, and
 * the app renders blank with "Export extendClient doesn't exist in target
 * module". useWallets() from that module also throws on a null connectors
 * object when no connector config is set. The embedded wallet is right here in
 * the user object and needs none of it. This is recorded in CLAUDE.md as a
 * trap; it cost a day once already.
 */

/** Enough of an address to recognise, short enough for a header. */
function short(address: string): string {
  return address.length > 10 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address;
}

/**
 * Two letters for the disc.
 *
 * Email before name: Privy's Google accounts always carry an email and only
 * sometimes a name, so preferring the name means the disc silently falls back
 * to "?" for some users and not others.
 */
function initials(email: string | null, name: string | null): string {
  const source = (name ?? email ?? "").trim();
  if (!source) return "··";
  const parts = source.split(/[\s.@_-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

export function AccountMenu() {
  const { ready, authenticated, user, logout } = usePrivy();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // Clicking anywhere else closes it. On the document, because the click that
  // needs to close this is precisely the one that never reaches it.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  /*
   * Reserve the space while Privy restores the session.
   *
   * Rendering nothing until ready makes the whole header shift sideways a
   * beat after load, which is the single most noticeable jump on the page
   * because it moves the balance the user is looking at.
   */
  if (!ready || !authenticated || !user) {
    return <div className="h-8 w-8 shrink-0 rounded-full bg-raised" aria-hidden />;
  }

  const email = user.google?.email ?? user.email?.address ?? null;
  const name = user.google?.name ?? null;

  /*
   * The embedded Solana wallet.
   *
   * Found by filtering linkedAccounts rather than asking a wallet hook — see
   * the note at the top of this file. walletClientType narrows it to the one
   * Privy created; an external wallet the user linked themselves would also
   * be type "wallet" with chainType "solana", and is not the account cipher
   * trades from.
   */
  const wallet = user.linkedAccounts.find(
    (a) =>
      a.type === "wallet" &&
      a.chainType === "solana" &&
      a.walletClientType === "privy",
  ) as { address: string } | undefined;

  async function copyAddress() {
    if (!wallet) return;
    try {
      await navigator.clipboard.writeText(wallet.address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* Clipboard is blocked in some contexts. The address is on screen and
         selectable either way, so failing silently loses nothing. */
    }
  }

  return (
    <div ref={box} className="relative shrink-0">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Account"
        title={email ?? "Account"}
        className="grid h-8 w-8 place-items-center rounded-full bg-accent font-sans text-[11px] font-extrabold text-ink transition-[filter] hover:brightness-110"
      >
        {initials(email, name)}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-40 mt-2 w-64 overflow-hidden rounded-xl border border-line bg-panel shadow-2xl"
        >
          <div className="border-b border-hairline px-3 py-2.5">
            <div className="truncate font-sans text-[12px] font-bold text-champagne">
              {name ?? email ?? "Signed in"}
            </div>
            {name && email && (
              <div className="truncate font-sans text-[10.5px] text-ash">{email}</div>
            )}
          </div>

          <div className="px-3 py-2.5">
            <div className="font-sans text-[9.5px] font-bold uppercase tracking-[0.11em] text-ash">
              Solana wallet
            </div>
            {wallet ? (
              <button
                onClick={copyAddress}
                className="mt-1 flex w-full items-center justify-between gap-2 rounded-lg bg-slate px-2 py-1.5 text-left transition-colors hover:bg-raised"
              >
                <span className="truncate font-mono text-[11.5px] text-champagne">
                  {short(wallet.address)}
                </span>
                <span className="shrink-0 font-sans text-[10px] text-ash">
                  {copied ? "copied" : "copy"}
                </span>
              </button>
            ) : (
              /* Privy creates it on login for users without one, so this is
                 either a first render or a genuine failure. Saying which is
                 not possible from here, so say neither. */
              <p className="mt-1 font-sans text-[11px] leading-relaxed text-mute">
                No embedded wallet on this account yet.
              </p>
            )}
          </div>

          <button
            onClick={() => {
              setOpen(false);
              logout();
            }}
            role="menuitem"
            className="w-full border-t border-hairline px-3 py-2.5 text-left font-sans text-[12px] font-bold text-ash transition-colors hover:bg-slate hover:text-down"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
