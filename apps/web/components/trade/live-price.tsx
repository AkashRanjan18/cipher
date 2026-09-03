"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { TokenStats } from "@/lib/market";

/**
 * One price poll, shared by every panel that needs it.
 *
 * The header and the chart both want a live price. Polling separately would
 * double the upstream cost for the same number, and the free tier's ~30
 * req/min is the WHOLE APP's budget — see the ceiling note in discover.ts.
 * So the fetch lives here and both consume it.
 *
 * A context provider is used rather than prop drilling because the terminal
 * page is a server component: it cannot hold client state, and the header and
 * chart sit in different subtrees. This wrapper is a client component whose
 * children pass straight through, so the panes stay server-rendered.
 */

interface Live {
  stats: TokenStats;
  /** False once a poll has failed — the number on screen is last known good. */
  fresh: boolean;
}

const LiveContext = createContext<Live | null>(null);

export function useLive(): Live {
  const v = useContext(LiveContext);
  if (!v) throw new Error("useLive must be used inside <LivePrice>");
  return v;
}

export function LivePrice({
  initial,
  children,
}: {
  initial: TokenStats;
  children: ReactNode;
}) {
  const [stats, setStats] = useState(initial);
  const [fresh, setFresh] = useState(true);

  /*
   * The mint is read from a ref so it cannot restart the interval. Reading it
   * from `stats` would put the polled object in the effect's dependencies and
   * every successful poll would tear down and rebuild the timer.
   */
  const mint = useRef(initial.mint);

  useEffect(() => {
    mint.current = initial.mint;
    setStats(initial);
    setFresh(true);
  }, [initial]);

  useEffect(() => {
    let alive = true;

    const tick = async () => {
      try {
        const res = await fetch(`/api/stats?mint=${mint.current}`);
        if (!res.ok) {
          if (alive) setFresh(false);
          return;
        }
        const { stats } = (await res.json()) as { stats: TokenStats };
        if (!alive) return;
        setStats(stats);
        setFresh(true);
      } catch {
        /*
         * A failed poll keeps the last good price on screen and flags it as
         * stale. Blanking the number would be worse: a trader reads an empty
         * price as "no market", and reads a frozen one as "quiet" — only the
         * staleness marker tells the truth, which is "we don't know".
         */
        if (alive) setFresh(false);
      }
    };

    // Matched to the server cache window; polling faster only re-reads the
    // same cached response while spending the shared upstream budget.
    const id = setInterval(tick, 15000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  return (
    <LiveContext.Provider value={{ stats, fresh }}>
      {children}
    </LiveContext.Provider>
  );
}
