"use client";

import { useEffect, useState } from "react";
import type { Preview } from "@/lib/chain/preview";

/**
 * Above this loss to the pool, the trade is shown and paused on; below it,
 * nothing is said. The user's call, 28 Sep 2026: memecoin swaps routinely
 * cost a few percent to the pool, and a line on every ordinary trade is
 * noise that teaches people to ignore the one that matters.
 */
export const COSTLY_PCT = 3;

/**
 * The before-you-trade quote, for the ticket: what the dollars (or tokens)
 * are worth the moment the trade lands. See lib/chain/preview.ts.
 *
 * Debounced, because it is typed into: every keystroke is not a quote, and
 * each one spends a quote from the Jupiter allowance. The last answer stays on
 * screen while the next is fetched, so the line does not flicker.
 */
export function useTradePreview(
  mint: string | null,
  side: "buy" | "sell",
  /** Dollars into the pool (buy) or tokens (sell). */
  size: number,
): Preview | null {
  const [p, setP] = useState<Preview | null>(null);

  useEffect(() => {
    if (!mint || !(size > 0)) {
      setP(null);
      return;
    }
    const ctrl = new AbortController();
    const t = window.setTimeout(() => {
      void fetchPreview(mint, side, size, ctrl.signal).then((next) => {
        if (!ctrl.signal.aborted) setP(next);
      });
    }, 450);
    return () => {
      ctrl.abort();
      window.clearTimeout(t);
    };
  }, [mint, side, size]);

  return p;
}

/** One preview, or null when there is no route or price right now. */
export async function fetchPreview(
  mint: string,
  side: "buy" | "sell",
  size: number,
  signal?: AbortSignal,
): Promise<Preview | null> {
  try {
    const res = await fetch(
      `/api/preview?mint=${encodeURIComponent(mint)}&side=${side}&size=${size}`,
      { signal, cache: "no-store" },
    );
    if (!res.ok) return null;
    return ((await res.json()) as { preview: Preview }).preview;
  } catch {
    return null;
  }
}
