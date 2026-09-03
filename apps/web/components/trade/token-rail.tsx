"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { PoolSummary } from "@/lib/market";

/**
 * The discovery rail — trending, new, and search results in one column.
 *
 * Client component because it owns three pieces of interactive state: which
 * tab is active, the search query, and the debounce. Seeded with lists the
 * server already fetched, so it is populated on first paint.
 *
 * Search does not get its own tab. Typing REPLACES the list and clearing the
 * box restores it — a separate results view would make the user navigate
 * back to get to trending, which is one interaction too many for a panel
 * people glance at.
 */

type Tab = "trending" | "new";

/** Null is "the source did not say", which is not the same as "flat". */
function pct(n: number | null): string {
  if (n === null) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

/** Pool age is the memecoin risk signal — a 40-minute-old pool is not BONK. */
function age(unix: number | null): string {
  if (unix === null) return "";
  const s = Math.max(0, Math.floor(Date.now() / 1000) - unix);
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return n.toFixed(0);
}

function Row({ pool, active }: { pool: PoolSummary; active: boolean }) {
  const change = pool.change1h;
  return (
    <Link
      href={`/trade/${pool.mint}`}
      className={`block border-b border-champagne/5 px-3 py-2 transition-colors ${
        active ? "bg-champagne/10" : "hover:bg-champagne/5"
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate font-mono text-xs text-champagne">
          {pool.symbol}
        </span>
        <span
          className={`shrink-0 font-mono text-xs tabular-nums ${
            change === null
              ? "text-ash"
              : change >= 0
                ? "text-green-400"
                : "text-red-400"
          }`}
        >
          {pct(change)}
        </span>
      </div>
      <div className="mt-0.5 flex items-baseline justify-between gap-2 font-mono text-[10px] text-ash">
        <span className="truncate">
          {/* Liquidity, not market cap. On a fresh pool mcap is a fiction the
              deployer chose; liquidity is what you can actually sell into. */}
          liq ${compact(pool.liquidityUsd)}
        </span>
        <span className="shrink-0 tabular-nums">{age(pool.createdAt)}</span>
      </div>
    </Link>
  );
}

export function TokenRail({
  trending,
  fresh,
  unavailable = false,
}: {
  trending: PoolSummary[];
  fresh: PoolSummary[];
  /** The upstream list failed — usually a shared rate limit, not an empty market. */
  unavailable?: boolean;
}) {
  const [tab, setTab] = useState<Tab>("trending");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PoolSummary[] | null>(null);
  const [searchFailed, setSearchFailed] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults(null);
      setSearchFailed(false);
      return;
    }

    /*
     * Debounce, and abort in flight. Without the abort, a fast typist gets
     * responses out of order and the list settles on whichever request
     * happened to finish last — usually the shortest, least specific query.
     */
    const ctrl = new AbortController();
    const id = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
          signal: ctrl.signal,
        });
        // 503 is an upstream rate limit, not an absence of matches.
        if (res.status === 503) {
          setSearchFailed(true);
          setResults([]);
          return;
        }
        if (!res.ok) return;
        const { results } = (await res.json()) as { results: PoolSummary[] };
        setSearchFailed(false);
        setResults(results);
      } catch {
        // Aborted or offline. The previous list stays on screen.
      }
    }, 250);

    return () => {
      clearTimeout(id);
      ctrl.abort();
    };
  }, [query]);

  const list = results ?? (tab === "trending" ? trending : fresh);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-champagne/10 bg-slate">
      <div className="shrink-0 border-b border-champagne/10 p-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="search token or paste mint"
          aria-label="Search tokens"
          className="w-full rounded-lg border border-champagne/12 bg-ink px-2.5 py-1.5 font-mono text-xs text-champagne placeholder:text-ash/60 focus:border-champagne/30 focus:outline-none"
        />
      </div>

      {/* Tabs hide while searching — they control a list that is not on
          screen, and a live control that does nothing is worse than none. */}
      {!results && (
        <div className="flex shrink-0 gap-1 border-b border-champagne/10 px-2 py-1.5">
          {(["trending", "new"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              aria-pressed={tab === t}
              className={`rounded px-2 py-1 font-mono text-[11px] transition-colors ${
                tab === t
                  ? "bg-champagne/15 text-champagne"
                  : "text-ash hover:text-champagne"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {list.length === 0 ? (
          <p className="p-3 font-mono text-[11px] leading-relaxed text-ash">
            {/* Never say "nothing is trending" when the truth is "we could
                not ask" — that is a claim about the market. */}
            {searchFailed
              ? "search unavailable — rate limited upstream. try again shortly."
              : results
                ? "no matches"
                : unavailable
                  ? "list unavailable — rate limited upstream. search still works."
                  : "no matches"}
          </p>
        ) : (
          list.map((p) => (
            <Row
              key={p.pairAddress}
              pool={p}
              active={pathname === `/trade/${p.mint}`}
            />
          ))
        )}
      </div>
    </div>
  );
}
