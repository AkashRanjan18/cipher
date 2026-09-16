"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * ONE PRICE PER COIN, ON THE WHOLE SCREEN.
 *
 * The chart header said SOL was $100.77 and the row in the left panel said
 * $100.74, at the same moment, for the same coin. Both were "right": the
 * header polled /api/prices every five seconds, and the row carried whatever
 * price came back with the token list fifteen seconds earlier, from a
 * different Jupiter endpoint. Two sources, two cadences, two numbers.
 *
 * On a chart that is untidy. On a ledger it is corrosive — the number a user
 * decides from has to be the number they are shown, and if the same asset can
 * wear two prices in one viewport then neither of them means anything.
 *
 * So there is one poll, one interval, one object, and everything reads from
 * it. Consumers register the mints they are showing; the union is fetched
 * together and handed back by mint.
 *
 * cipher: five seconds is the ceiling of a REST feed, not of the product. The
 * upgrade is a pool-account websocket, which is the one thing an RPC provider
 * genuinely sells — and when it lands it replaces the body of this file and
 * nothing that reads it.
 */

export interface Mark {
  usd: number;
  /** Percent, over 24h. From the same response as the price. */
  change24h: number;
  /** The Solana slot the price was derived at. */
  blockId: number;
  /** Dollars of liquidity behind the price. The AMM's answer to "depth". */
  liquidityUsd: number | null;
}

interface Ctx {
  marks: Record<string, Mark>;
  /** Register the mints a component is displaying, under a stable key. */
  watch(key: string, mints: string[]): void;
}

const SolPriceContext = createContext<Ctx | null>(null);

/**
 * The cadence, and why it is not faster.
 *
 * /api/prices caches for five seconds server-side, so polling faster than that
 * fetches the same bytes and spends Jupiter's allowance for nothing — the
 * limit is per deployment, not per user. Matching the two numbers is the point.
 */
const EVERY_MS = 5_000;

/** Jupiter takes 50 ids per request; asking for more is two round trips. */
const MAX_MINTS = 60;

export function SolPriceProvider({ children }: { children: ReactNode }) {
  const [marks, setMarks] = useState<Record<string, Mark>>({});

  /*
   * A ref, not state. Registering is a side effect of rendering a list, and
   * putting the registry in state would re-render every consumer each time a
   * feed refreshed its rows — which is every fifteen seconds, for a set that
   * has usually not changed.
   */
  const watchers = useRef<Map<string, string[]>>(new Map());
  const [wanted, setWanted] = useState<string>("");

  const watch = useCallback((key: string, mints: string[]) => {
    watchers.current.set(key, mints);
    const union = new Set<string>();
    for (const list of watchers.current.values()) {
      for (const m of list) union.add(m);
    }
    /* Sorted and joined so the effect below re-runs when the SET changes and
       not when a list is merely rebuilt in a different order. */
    setWanted([...union].slice(0, MAX_MINTS).sort().join(","));
  }, []);

  useEffect(() => {
    if (!wanted) return;
    let alive = true;

    const load = async () => {
      try {
        const res = await fetch(`/api/prices?mints=${wanted}`);
        if (!res.ok || !alive) return;
        const body = (await res.json()) as {
          prices: Record<
            string,
            { usd: number; change24h?: number; blockId?: number; liquidityUsd?: number }
          >;
        };
        if (!alive) return;
        /*
         * MERGED, not replaced. A consumer that unmounts should not blank the
         * price of a coin another consumer is still showing, and a response
         * that omits a mint is a mint Jupiter had nothing for — not a mint
         * worth zero.
         */
        setMarks((prev) => {
          const next = { ...prev };
          for (const [mint, p] of Object.entries(body.prices ?? {})) {
            if (typeof p?.usd !== "number" || !Number.isFinite(p.usd)) continue;
            next[mint] = {
              usd: p.usd,
              change24h: typeof p.change24h === "number" ? p.change24h : 0,
              blockId: typeof p.blockId === "number" ? p.blockId : 0,
              liquidityUsd: typeof p.liquidityUsd === "number" ? p.liquidityUsd : null,
            };
          }
          return next;
        });
      } catch {
        /* A failed poll leaves the last good price on screen. Blanking a chart
           header because one request timed out is worse than a stale number. */
      }
    };

    void load();
    const id = window.setInterval(load, EVERY_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [wanted]);

  const value = useMemo<Ctx>(() => ({ marks, watch }), [marks, watch]);
  return <SolPriceContext.Provider value={value}>{children}</SolPriceContext.Provider>;
}

/**
 * Register mints and read their prices.
 *
 * `key` identifies the caller so two components watching different sets do not
 * overwrite each other — the market list and the open chart are exactly that.
 */
export function useSolPrices(key: string, mints: string[]): Record<string, Mark> {
  const ctx = useContext(SolPriceContext);
  const joined = mints.join(",");

  useEffect(() => {
    if (!ctx) return;
    ctx.watch(key, joined ? joined.split(",") : []);
    // `joined` is the dependency, not `mints`: a new array of the same mints
    // every render would re-register forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, joined]);

  return ctx?.marks ?? {};
}

/** Read one price without registering. For anything already being watched. */
export function useMark(mint: string | null): Mark | null {
  const ctx = useContext(SolPriceContext);
  if (!mint) return null;
  return ctx?.marks[mint] ?? null;
}
