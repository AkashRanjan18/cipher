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
  /**
   * The coin's full name — "Solana", not "SOL".
   *
   * A holdings card has room for it and reads better with it: "4.9745 Solana"
   * is a sentence and "4.9745 SOL" is a ticker tape. Falls back to the symbol
   * when a token has no name worth printing, which is most of the chain.
   */
  name: string;
  icon: string | null;
  /**
   * Units in existence, so a price can be read as a market cap.
   *
   * Derived as fdv / price rather than fetched: Jupiter reports both, and
   * their ratio IS the total supply. Null when either is missing — a listed
   * major has no token payload — and the caller shows a price instead of
   * inventing a cap from a supply it had to guess.
   *
   * TOTAL supply, not circulating, because `fdv` is the number the panel
   * already shows as market cap. Mixing the two would put an entry cap and a
   * current cap on different bases and make the comparison meaningless.
   */
  supply: number | null;
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
         * The listed table decides the NAME; Jupiter is still asked for the
         * supply.
         *
         * This used to short-circuit entirely for SOL, USDC and the rest, on
         * the reasoning that a verified symbol and a self-hosted logo beat
         * anything a search can return — which is true, and why the symbol
         * and icon below still come from the table. But it also meant those
         * coins never learned their supply, so switching the chart to market
         * cap left "Avg. entry $100.91" sitting under an axis in billions.
         *
         * So: listed wins on identity, Jupiter answers for the numbers, and a
         * failed lookup leaves a listed coin correctly named with no cap
         * rather than unnamed. See coin-mark.tsx for why the icon is local.
         */
        const listed = marketByMint(mint);
        let t: TokenInfo | null = null;
        try {
          const res = await fetch(`/api/token?q=${encodeURIComponent(mint)}`);
          if (res.ok) {
            const body = (await res.json()) as {
              resolution?: { kind: string; token?: TokenInfo };
            };
            t = body.resolution?.kind === "resolved" ? (body.resolution.token ?? null) : null;
          }
        } catch {
          /* Left out of the cache below only when there is nothing at all to
             store. A row reading as its own address is ugly and true; a row
             reading as the wrong coin is what this file exists to avoid. */
        }

        if (listed || t) {
          CACHE.set(mint, {
            symbol: listed?.symbol ?? t?.symbol ?? shortMint(mint),
            /* Jupiter's `name` is often just the ticker again; only take it
               when it actually says something different. */
            name:
              listed?.name ??
              (t?.name && t.name !== t.symbol ? t.name : (t?.symbol ?? shortMint(mint))),
            icon: listed ? null : (t?.icon ?? null),
            supply: t?.fdv && t.priceUsd > 0 ? t.fdv / t.priceUsd : null,
          });
          found = true;
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
    out[mint] =
      CACHE.get(mint) ?? { symbol: shortMint(mint), name: shortMint(mint), icon: null, supply: null };
  }
  return out;
}
