"use client";

import { useEffect, useState } from "react";
import type { Trade } from "@/lib/market";
import { useNow } from "./use-now";

/**
 * The live tape.
 *
 * Client component because it polls. Seeded with trades the server already
 * fetched, so the panel is full on first paint and the poll only ever
 * replaces it — no empty state, no spinner.
 */

function ago(unix: number, nowMs: number): string {
  const s = Math.max(0, Math.floor(nowMs / 1000) - unix);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

/** Terminals show size in k/M — $12,431 is four glyphs of noise in a column. */
function size(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  // Dust trades are most of a memecoin tape. Rounding them to a bare "$0"
  // reads as missing data rather than a small fill.
  if (n < 1) return n.toFixed(2);
  return n.toFixed(0);
}

export function TradeTape({
  pair,
  initial,
}: {
  pair: string;
  initial: Trade[];
}) {
  const [trades, setTrades] = useState(initial);
  const now = useNow();

  useEffect(() => {
    let alive = true;

    const tick = async () => {
      try {
        const res = await fetch(`/api/trades?pair=${pair}`);
        if (!res.ok) return;
        const { trades } = (await res.json()) as { trades: Trade[] };
        // The component may have unmounted mid-flight.
        if (alive) setTrades(trades);
      } catch {
        // A failed poll leaves the last good tape on screen. Blanking the
        // panel on a transient network blip is worse than showing stale.
      }
    };

    // Matched to the server cache window; polling faster only re-reads
    // the same cached response while spending the shared upstream budget.
    const id = setInterval(tick, 15000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [pair]);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-champagne/10 bg-slate">
      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-3 border-b border-champagne/10 px-3 py-2 font-mono text-[10px] tracking-[0.12em] text-ash">
        <span>PRICE</span>
        <span className="text-right">SIZE</span>
        <span className="text-right">WALLET</span>
        <span className="text-right">AGE</span>
      </div>

      {/* Fixed height + scroll, so an arriving trade cannot push the page
          layout around underneath the user's cursor. */}
      <div className="flex-1 overflow-y-auto">
        {/* Upstream returns ~300 trades; nobody scrolls past the first
            hundred, and re-rendering all of them every second to advance the
            age column is work with no reader. */}
        {trades.slice(0, 100).map((t) => (
          <div
            key={t.id}
            className="grid grid-cols-[1fr_auto_auto_auto] gap-3 px-3 py-1 font-mono text-[11px] tabular-nums hover:bg-champagne/5"
          >
            <span className={t.side === "buy" ? "text-green-400" : "text-red-400"}>
              {t.priceUsd.toPrecision(4)}
            </span>
            <span className="text-right text-champagne">${size(t.volumeUsd)}</span>
            <a
              href={`https://solscan.io/account/${t.wallet}`}
              target="_blank"
              rel="noreferrer"
              className="text-right text-ash hover:text-champagne"
            >
              {t.wallet.slice(0, 4)}
            </a>
            {/* Empty until mount — see useNow. */}
            <span className="w-8 text-right text-ash">
              {now === null ? "" : ago(t.time, now)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
