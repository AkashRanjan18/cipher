"use client";

import { useEffect, useState } from "react";

const KEY = "cipher.jurisdiction.attested";

/**
 * Jurisdiction attestation.
 *
 * The IP geoblock in middleware.ts is the first control; this is the second.
 * Together they are "reasonable measures": we block where we can detect, and
 * we require the user to state where they are.
 *
 * Neither stops a determined VPN user, and no control does. What they do is
 * establish that we did not knowingly serve a restricted market — which is the
 * distinction that actually matters if anyone ever asks.
 */
export function JurisdictionGate({ userId }: { userId?: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!userId) return;
    setOpen(localStorage.getItem(`${KEY}.${userId}`) !== "1");
  }, [userId]);

  if (!open || !userId) return null;

  function attest() {
    localStorage.setItem(`${KEY}.${userId}`, "1");
    // TODO(phase 1): also record server-side against the user id, with a
    // timestamp. localStorage is a UX convenience, not an audit record.
    setOpen(false);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="jg-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/80 p-6"
    >
      <div className="w-full max-w-md rounded border border-neutral-800 bg-neutral-900 p-6">
        <h2 id="jg-title" className="mb-3 text-lg font-semibold">
          Where are you trading from?
        </h2>

        <p className="mb-5 text-sm leading-relaxed text-neutral-400">
          cipher does not offer trading to people in the United States or in
          sanctioned jurisdictions. We don&rsquo;t hold the licences that would
          let us, and we&rsquo;d rather tell you now than after you&rsquo;ve
          funded an account.
        </p>

        <div className="flex flex-col gap-2">
          <button
            onClick={attest}
            className="rounded bg-amber-500 px-4 py-2.5 font-medium text-neutral-950 transition-colors hover:bg-amber-400 focus-visible:outline focus-visible:outline-2"
          >
            I am not in a restricted jurisdiction
          </button>
          <a
            href="/restricted"
            className="rounded border border-neutral-800 px-4 py-2.5 text-center text-sm text-neutral-400 transition-colors hover:border-neutral-600 focus-visible:outline focus-visible:outline-2"
          >
            I am — take me to the scanner
          </a>
        </div>
      </div>
    </div>
  );
}
