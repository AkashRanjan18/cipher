"use client";

import { useEffect, useState } from "react";
import type { Lifecycle, TokenInfo } from "@/lib/chain/tokens";

/**
 * The Solana universe, live.
 *
 * The left panel used to render MARKETS — fourteen Binance pairs, hardcoded —
 * which meant cipher listed fourteen coins on a chain with hundreds of
 * thousands. This is what replaces it: whatever is actually trading right now,
 * at whatever stage of its life.
 *
 * Polled rather than streamed, like useMajors and for the same reason: a list
 * is glanced at, not traded off. The chart is what needs tick-by-tick.
 *
 * ONE POLLER PER FEED, not per row. The route caches upstream, so the cost of
 * a thousand people watching the same feed is one Jupiter request — the whole
 * design of /api/discover rests on a launch list being identical for everyone
 * looking at it.
 */

export interface UniverseToken extends TokenInfo {
  /** Sentences, not a score. Empty for anything with nothing wrong with it. */
  warnings: string[];
}

export type Feed = "new" | "traded" | "organic";

export interface Universe {
  tokens: UniverseToken[];
  /** False until the first response lands. The list shows nothing, not zero. */
  loaded: boolean;
  /** Set when the feed itself is unavailable, which is not the same as empty. */
  error: string | null;
}

export function useUniverse(
  feed: Feed,
  stage: Lifecycle | null,
  intervalMs = 15_000,
): Universe {
  const [tokens, setTokens] = useState<UniverseToken[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    /*
     * Cleared on every feed change, not left showing the previous one.
     *
     * Switching from Graduated to Bonding and seeing graduated rows for a
     * beat is a list that lies about what it is showing, and the rows are
     * clickable while it lies.
     */
    setTokens([]);
    setLoaded(false);
    setError(null);

    const load = async () => {
      try {
        const q = new URLSearchParams({ feed, limit: "60" });
        if (stage) q.set("stage", stage);
        const res = await fetch(`/api/discover?${q}`);
        if (!alive) return;
        if (!res.ok) {
          setError("Token feed unavailable.");
          setLoaded(true);
          return;
        }
        const body = (await res.json()) as { tokens: UniverseToken[] };
        if (!alive) return;
        setTokens(body.tokens ?? []);
        setError(null);
        setLoaded(true);
      } catch {
        /* A failed poll leaves the last good list on screen. Blanking it
           because one request timed out is worse than a stale row. */
        if (alive) setLoaded(true);
      }
    };

    void load();
    const id = setInterval(load, intervalMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [feed, stage, intervalMs]);

  return { tokens, loaded, error };
}
