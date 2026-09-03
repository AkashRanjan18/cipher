"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { PoolSummary } from "@/lib/market";
import { useNow } from "./use-now";

/**
 * The discovery home — the front door to the terminal.
 *
 * Without it the only way to reach a token is to already know its mint, which
 * is the one thing a new user does not have. fomo, Photon and BullX all open
 * on a list for the same reason: choosing what to trade is the first
 * decision, not the second.
 *
 * A grid rather than the narrow rail: this is the whole screen, so there is
 * room for the numbers that actually drive the choice.
 */

function pct(n: number | null): string {
  if (n === null) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function compact(n: number): string {
  if (n >= 1_000_000_000_000) return `${(n / 1_000_000_000_000).toFixed(1)}T`;
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return n.toFixed(0);
}

function age(unix: number | null, nowMs: number | null): string {
  if (unix === null || nowMs === null) return "";
  const s = Math.max(0, Math.floor(nowMs / 1000) - unix);
  if (s < 3600) return `${Math.floor(s / 60)}m old`;
  if (s < 86400) return `${Math.floor(s / 3600)}h old`;
  return `${Math.floor(s / 86400)}d old`;
}

function Card({ pool, now }: { pool: PoolSummary; now: number | null }) {
  const c = pool.change24h;
  return (
    <Link
      href={`/trade/${pool.mint}`}
      className="flex flex-col gap-3 rounded-xl border border-line bg-panel p-4 transition-colors hover:border-champagne/30"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate font-mono text-sm text-champagne">
          {pool.symbol}
        </span>
        <span
          className={`shrink-0 font-mono text-sm tabular-nums ${
            c === null ? "text-ash" : c >= 0 ? "text-up" : "text-down"
          }`}
        >
          {pct(c)}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-y-1.5 font-mono text-[11px]">
        <span className="text-ash">liquidity</span>
        <span className="text-right tabular-nums text-champagne">
          ${compact(pool.liquidityUsd)}
        </span>
        <span className="text-ash">24h volume</span>
        <span className="text-right tabular-nums text-champagne">
          ${compact(pool.volume24h)}
        </span>
        <span className="text-ash">{pool.dex}</span>
        <span className="text-right tabular-nums text-ash">
          {age(pool.createdAt, now)}
        </span>
      </div>
    </Link>
  );
}

export function DiscoverGrid({
  trending,
  fresh,
  unavailable = false,
}: {
  trending: PoolSummary[];
  fresh: PoolSummary[];
  unavailable?: boolean;
}) {
  const [tab, setTab] = useState<"trending" | "new">("trending");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PoolSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const now = useNow(60_000);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults(null);
      setFailed(false);
      return;
    }

    // Debounce and abort — see token-rail for why both are needed.
    const ctrl = new AbortController();
    const id = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
          signal: ctrl.signal,
        });
        if (res.status === 503) {
          setFailed(true);
          setResults([]);
          return;
        }
        if (!res.ok) return;
        const { results } = (await res.json()) as { results: PoolSummary[] };
        setFailed(false);
        setResults(results);
      } catch {
        // Aborted or offline; the previous list stays.
      }
    }, 250);

    return () => {
      clearTimeout(id);
      ctrl.abort();
    };
  }, [query]);

  const list = results ?? (tab === "trending" ? trending : fresh);

  return (
    <div className="flex flex-col gap-6">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="search a token, or paste a contract address"
        aria-label="Search tokens"
        className="w-full rounded-xl border border-line bg-panel px-4 py-3 font-mono text-sm text-champagne placeholder:text-ash/60 focus:border-champagne/30 focus:outline-none"
      />

      {!results && (
        <div className="flex gap-1">
          {(["trending", "new"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              aria-pressed={tab === t}
              className={`rounded-lg px-3 py-1.5 font-mono text-xs transition-colors ${
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

      {list.length === 0 ? (
        <p className="font-mono text-xs leading-relaxed text-ash">
          {/* Never report a rate limit as an empty market. */}
          {failed
            ? "search unavailable — rate limited upstream. try again shortly."
            : results
              ? "no matches"
              : unavailable
                ? "list unavailable — rate limited upstream. search still works."
                : "no matches"}
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {list.map((p) => (
            <Card key={p.pairAddress} pool={p} now={now} />
          ))}
        </div>
      )}
    </div>
  );
}
