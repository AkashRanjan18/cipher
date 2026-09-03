"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { PoolSummary, Major } from "@/lib/market";
import { useNow } from "./use-now";
import { usd, compact, compactUsd, pct, since } from "@/lib/format";

/**
 * The discovery rail — blue chips, trending, new, and search in one column.
 *
 * Client component: it owns the active tab, the query and the debounce.
 * Seeded with lists the server already fetched, so it is populated on first
 * paint.
 *
 * Search does not get its own tab. Typing REPLACES the list and clearing the
 * box restores it — a separate results view would make the user navigate back
 * to reach trending, which is one interaction too many for a panel people
 * glance at.
 *
 * Rows are deliberately tall. An earlier pass fit more of them on screen at
 * 10px and the column read as a log file; the logo and the two-line stack are
 * what make a row scannable without reading it.
 */

type Tab = "crypto" | "trending" | "new";

function Logo({ src, symbol }: { src: string | null; symbol: string }) {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element -- token CDNs vary
    // per token; listing them all in next.config is not possible.
    return (
      <img
        src={src}
        alt=""
        className="h-8 w-8 shrink-0 rounded-full border border-line object-cover"
      />
    );
  }
  // A missing logo becomes an initial rather than a gap, so rows stay aligned.
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-ink font-sans text-xs text-ash">
      {symbol.slice(0, 1).toUpperCase()}
    </div>
  );
}

function Change({ value }: { value: number | null }) {
  return (
    <span
      className={`font-mono text-xs tabular-nums ${
        value === null ? "text-ash" : value >= 0 ? "text-up" : "text-down"
      }`}
    >
      {pct(value)}
    </span>
  );
}

/**
 * A blue chip row.
 *
 * Deliberately NOT a link. BTC and ETH do not trade on a Solana AMM, so a
 * /trade/[mint] route for them would 404 or, worse, land on a wrapped
 * imitation. They are here for orientation — when SOL is down 6%, a memecoin
 * flat on the day is actually strong, and nothing else on screen says so.
 */
function MajorRow({ m }: { m: Major }) {
  return (
    <div className="flex items-center gap-2.5 border-b border-hairline px-3 py-2.5">
      <Logo src={m.imageUrl} symbol={m.symbol} />
      <div className="flex min-w-0 flex-col">
        <span className="font-sans text-sm font-medium text-champagne">
          {m.symbol}
        </span>
        {m.marketCap && (
          <span className="font-mono text-[11px] text-ash">
            {compact(m.marketCap)} MC
          </span>
        )}
      </div>
      <div className="ml-auto flex flex-col items-end">
        <span className="font-mono text-sm tabular-nums text-champagne">
          {usd(m.priceUsd)}
        </span>
        <Change value={m.change24h} />
      </div>
    </div>
  );
}

function PoolRow({
  pool,
  active,
  now,
}: {
  pool: PoolSummary;
  active: boolean;
  now: number | null;
}) {
  return (
    <Link
      href={`/trade/${pool.mint}`}
      className={`flex items-center gap-2.5 border-b border-hairline px-3 py-2.5 transition-colors ${
        active ? "bg-champagne/10" : "hover:bg-champagne/5"
      }`}
    >
      <Logo src={pool.imageUrl} symbol={pool.symbol} />
      <div className="flex min-w-0 flex-col">
        <span className="truncate font-sans text-sm font-medium text-champagne">
          {pool.symbol}
        </span>
        <span className="font-mono text-[11px] text-ash">
          {/* Liquidity, not market cap. On a fresh pool mcap is a fiction the
              deployer chose; liquidity is what you can actually sell into. */}
          {compactUsd(pool.liquidityUsd)} liq
        </span>
      </div>
      <div className="ml-auto flex shrink-0 flex-col items-end">
        <Change value={pool.change1h} />
        <span className="font-mono text-[11px] tabular-nums text-ash">
          {since(pool.createdAt, now)}
        </span>
      </div>
    </Link>
  );
}

export function TokenRail({
  majors,
  trending,
  fresh,
  unavailable = false,
}: {
  majors: Major[];
  trending: PoolSummary[];
  fresh: PoolSummary[];
  /** The upstream list failed — usually a rate limit, not an empty market. */
  unavailable?: boolean;
}) {
  const [tab, setTab] = useState<Tab>("trending");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PoolSummary[] | null>(null);
  const [searchFailed, setSearchFailed] = useState(false);
  const pathname = usePathname();
  // Pool ages advance slowly; a minute costs far fewer renders than a second.
  const now = useNow(60_000);

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
  // Searching replaces whatever tab is active, blue chips included.
  const showMajors = !results && tab === "crypto";

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-panel">
      <div className="shrink-0 p-2.5">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search"
          aria-label="Search tokens"
          className="w-full rounded-lg border border-line bg-ink px-3 py-2 font-sans text-sm text-champagne placeholder:text-ash/60 focus:border-champagne/30 focus:outline-none"
        />
      </div>

      {/* Tabs hide while searching — they control a list that is not on
          screen, and a live control that does nothing is worse than none. */}
      {!results && (
        <div className="flex shrink-0 gap-4 border-b border-line px-3">
          {(["crypto", "trending", "new"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              aria-pressed={tab === t}
              /* Underline rather than a pill: tabs that change the list below
                 should look attached to it. */
              className={`-mb-px border-b-2 pb-2 pt-1 font-sans text-sm capitalize transition-colors ${
                tab === t
                  ? "border-champagne text-champagne"
                  : "border-transparent text-ash hover:text-champagne"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {showMajors ? (
          majors.map((m) => <MajorRow key={m.id} m={m} />)
        ) : list.length === 0 ? (
          <p className="p-3 font-sans text-xs leading-relaxed text-ash">
            {/* Never say "nothing is trending" when the truth is "we could
                not ask" — that is a claim about the market. */}
            {searchFailed
              ? "Search unavailable — rate limited upstream. Try again shortly."
              : results
                ? "No matches"
                : unavailable
                  ? "List unavailable — rate limited upstream. Search still works."
                  : "No matches"}
          </p>
        ) : (
          list.map((p) => (
            <PoolRow
              key={p.pairAddress}
              pool={p}
              active={pathname === `/trade/${p.mint}`}
              now={now}
            />
          ))
        )}
      </div>
    </div>
  );
}
