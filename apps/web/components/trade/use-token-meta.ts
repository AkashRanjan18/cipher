"use client";

import { useEffect, useState } from "react";
import { marketByMint } from "@/lib/chain/markets";
import type { TokenInfo } from "@/lib/chain/tokens";

/**
 * WHAT TO CALL THE COINS YOU HOLD.
 *
 * The ledger stores a mint and nothing else — on purpose, because anyone can
 * mint a token called SOL for a couple of dollars, so the address is the
 * identity and the ticker is a display string. That is the right call and it
 * leaves the positions panel with a list of base58 and no way to label it.
 *
 * `useTokenInfo` answers the same question for ONE mint and cannot be reached
 * for a list: hooks do not run in a loop whose length changes. This resolves a
 * set, and it is deliberately the cheap half of that hook — a name and a
 * picture, not the price, the volumes or the risk rules, none of which a row
 * in a holdings list shows.
 *
 * cipher: one request per unseen mint, through a route Next caches for sixty
 * seconds. A portfolio of five coins is five requests, once, and the cache
 * below means switching tabs costs nothing. Jupiter's search does take a
 * comma-separated list; batching is a route change, worth making the day
 * somebody holds thirty coins and not before.
 */
export interface TokenMeta {
  symbol: string;
  icon: string | null;
}

/**
 * Resolved mints, outside React and shared by every caller.
 *
 * Module scope rather than state because the answer does not change and the
 * panel unmounts every time the tab does: keeping it in a component would
 * refetch the same five tokens on every switch between Open and Closed.
 * Failures are deliberately NOT cached, so a lookup that lost the network is
 * retried rather than remembered as a dash forever.
 */
const CACHE = new Map<string, TokenMeta>();

/** The address, shortened, for a mint nothing has resolved yet. */
export function shortMint(mint: string): string {
  return mint.length > 10 ? `${mint.slice(0, 4)}…${mint.slice(-4)}` : mint;
}

export function useTokenMeta(mints: string[]): Record<string, TokenMeta> {
  /* Sorted and joined, so the effect's dependency is the SET rather than the
     array — the same mints in a different order must not refetch. */
  const key = [...new Set(mints.filter(Boolean))].sort().join(",");
  const [, bump] = useState(0);

  useEffect(() => {
    const wanted = key ? key.split(",") : [];
    const missing = wanted.filter((m) => !CACHE.has(m));
    if (missing.length === 0) return;

    let alive = true;
    void (async () => {
      let found = false;
      for (const mint of missing) {
        /*
         * The listed table first, and it never touches the network.
         *
         * SOL, USDC and the rest of the majors have a verified symbol and a
         * self-hosted logo already — going to Jupiter for those is a request
         * that can only return something worse, since its search answers
         * "DOGE" with a 2,028-holder impostor. See coin-mark.tsx.
         */
        const listed = marketByMint(mint);
        if (listed) {
          CACHE.set(mint, { symbol: listed.symbol, icon: null });
          found = true;
          continue;
        }
        try {
          const res = await fetch(`/api/token?q=${encodeURIComponent(mint)}`);
          if (!res.ok) continue;
          const body = (await res.json()) as {
            resolution?: { kind: string; token?: TokenInfo };
          };
          const t = body.resolution?.kind === "resolved" ? body.resolution.token : null;
          if (!t) continue;
          CACHE.set(mint, { symbol: t.symbol || shortMint(mint), icon: t.icon ?? null });
          found = true;
        } catch {
          /* Left out of the cache so it is tried again. A row reading as its
             own address is ugly and true; a row reading as the wrong coin is
             the thing this whole file exists to avoid. */
        }
      }
      if (alive && found) bump((n) => n + 1);
    })();

    return () => {
      alive = false;
    };
  }, [key]);

  const out: Record<string, TokenMeta> = {};
  for (const mint of key ? key.split(",") : []) {
    out[mint] = CACHE.get(mint) ?? { symbol: shortMint(mint), icon: null };
  }
  return out;
}
