"use client";

import { useEffect, useState } from "react";
import type { Trade } from "@/lib/market";
import { useNow } from "./use-now";
import { price, compactUsd, since } from "@/lib/format";




export function TradeTape({
  pair,
  initial,
  bare = false,
}: {
  pair: string;
  initial: Trade[];
  /** Rendered inside a panel that already owns the frame and the scroll. */
  bare?: boolean;
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

  const header = (
    <div className="grid grid-cols-[1.2fr_1fr_1fr_0.6fr] gap-3 border-b border-line px-3 py-2 font-sans text-[11px] text-ash">
      <span>Price</span>
      <span className="text-right">Size</span>
      <span className="text-right">Wallet</span>
      <span className="text-right">Age</span>
    </div>
  );

  /*
   * Upstream returns ~300 trades; nobody scrolls past the first hundred, and
   * re-rendering all of them every second to advance the age column is work
   * with no reader.
   */
  const rows = trades.slice(0, 100).map((t) => (
    <div
      key={t.id}
      className="grid grid-cols-[1.2fr_1fr_1fr_0.6fr] gap-3 px-3 py-1.5 font-mono text-xs tabular-nums hover:bg-champagne/5"
    >
      <span className={t.side === "buy" ? "text-up" : "text-down"}>
        {price(t.priceUsd)}
      </span>
      <span className="text-right text-champagne">{compactUsd(t.volumeUsd)}</span>
      <a
        href={`https://solscan.io/account/${t.wallet}`}
        target="_blank"
        rel="noreferrer"
        className="text-right text-ash hover:text-champagne"
      >
        {t.wallet.slice(0, 4)}
      </a>
      {/* Empty until mount — see useNow. */}
      <span className="text-right text-ash">
        {since(t.time, now)}
      </span>
    </div>
  ));

  if (bare) {
    return (
      <div className="flex flex-col">
        {header}
        {rows}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-line bg-panel">
      {header}
      {/* Fixed height + scroll, so an arriving trade cannot push the page
          layout around underneath the cursor. */}
      <div className="min-h-0 flex-1 overflow-y-auto">{rows}</div>
    </div>
  );
}
