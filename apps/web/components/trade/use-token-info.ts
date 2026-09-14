"use client";

import { useEffect, useState } from "react";
import type { TokenInfo } from "@/lib/chain/tokens";

/**
 * What a mint actually is.
 *
 * The left panel already knows — it rendered the row — but the terminal is
 * not given the row, only the mint, and it must not be: a symbol passed down
 * from a list is a symbol the header would then trust. Anyone can mint a token
 * called SOL. Resolving from the mint means the header names whatever that
 * address really is, whichever list the click came from.
 *
 * Null mint means a Binance pair is open, and the hook stands down.
 */
export function useTokenInfo(mint: string | null): TokenInfo | null {
  const [token, setToken] = useState<TokenInfo | null>(null);

  useEffect(() => {
    if (!mint) {
      setToken(null);
      return;
    }
    let alive = true;
    /* Cleared first: showing the previous token's name against this token's
       price, even for one frame, is the header lying about what is open. */
    setToken(null);

    void (async () => {
      try {
        const res = await fetch(`/api/token?q=${encodeURIComponent(mint)}`);
        if (!res.ok || !alive) return;
        const body = (await res.json()) as {
          resolution?: { kind: string; token?: TokenInfo };
        };
        const r = body.resolution;
        if (alive && r?.kind === "resolved" && r.token) setToken(r.token);
      } catch {
        /* The header falls back to the mint's own listed name, or an ellipsis.
           A failed lookup must not take the chart down with it. */
      }
    })();

    return () => {
      alive = false;
    };
  }, [mint]);

  return token;
}
