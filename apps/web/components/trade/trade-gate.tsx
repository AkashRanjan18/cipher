"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePrivy } from "@privy-io/react-auth";

/**
 * Gates the regulated action, not the account.
 *
 * The restriction is on trading, not on having a login — so the attestation
 * belongs in front of the first trade, never in front of sign-in. Interrupting
 * someone the moment they authenticate is exactly the wrong place: it breaks
 * the thirty-second path, and it asks the question before there is anything to
 * answer it about.
 *
 * Wrap the first trade surface in this. Browsing, the scanner, and the feed
 * stay untouched.
 */
export function TradeGate({ children }: { children: ReactNode }) {
  const { authenticated } = usePrivy();
  const [attested, setAttested] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!authenticated) return;
    let cancelled = false;
    fetch("/api/attest")
      .then((r) => r.json())
      .then((d) => !cancelled && setAttested(Boolean(d.attested)))
      .catch(() => !cancelled && setAttested(false));
    return () => {
      cancelled = true;
    };
  }, [authenticated]);

  if (!authenticated || attested === null || attested) return <>{children}</>;

  async function attest() {
    setSaving(true);
    const res = await fetch("/api/attest", { method: "POST" });
    setSaving(false);
    if (res.ok) setAttested(true);
  }

  return (
    <div className="rounded border border-neutral-800 bg-neutral-900 p-5">
      <h2 className="mb-2 text-base font-semibold">One thing before you trade</h2>

      <p className="mb-4 text-sm leading-relaxed text-neutral-400">
        cipher doesn&rsquo;t offer trading to people in the United States or in
        sanctioned jurisdictions. We don&rsquo;t hold the licences that would
        let us, and we&rsquo;d rather say so now than after you&rsquo;ve funded
        an account.
      </p>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={attest}
          disabled={saving}
          className="rounded bg-amber-500 px-4 py-2 text-sm font-medium text-neutral-950 transition-colors hover:bg-amber-400 disabled:opacity-50 focus-visible:outline focus-visible:outline-2"
        >
          {saving ? "Saving…" : "I'm not in a restricted jurisdiction"}
        </button>
        <a
          href="/restricted"
          className="rounded border border-neutral-800 px-4 py-2 text-sm text-neutral-400 transition-colors hover:border-neutral-600 focus-visible:outline focus-visible:outline-2"
        >
          I am
        </a>
      </div>
    </div>
  );
}
