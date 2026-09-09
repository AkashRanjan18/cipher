"use client";

import { useEffect, useState } from "react";
import type { Major } from "@/lib/market";

/**
 * Live prices for every market in the list.
 *
 * Polled, not streamed. Binance will stream all fourteen over one socket, but
 * a list is glanced at rather than traded off, and a socket per surface is a
 * reconnect loop per surface to get wrong. The chart is the thing that needs
 * tick-by-tick, and it already has its own.
 *
 * Called ONCE, in the terminal, and passed down — the left panel and the
 * bottom ticker show the same numbers, and two independent pollers would show
 * them disagreeing by a few seconds on the same screen.
 */
export function useMajors(intervalMs = 10_000): Major[] {
  const [majors, setMajors] = useState<Major[]>([]);

  useEffect(() => {
    let alive = true;

    const load = async () => {
      try {
        const res = await fetch("/api/majors");
        if (!res.ok) return;
        const { majors: next } = (await res.json()) as { majors: Major[] };
        // Checked after the await as well as before: the component can unmount
        // while the request is in flight, and setting state then is a leak.
        if (alive) setMajors(next);
      } catch {
        /* A failed poll leaves the last good prices on screen. Blanking the
           list because one request timed out is worse than a stale number. */
      }
    };

    load();
    const id = setInterval(load, intervalMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [intervalMs]);

  return majors;
}
