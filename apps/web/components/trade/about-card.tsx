"use client";

import { useLive } from "./live-price";
import type { MarketWindow, WindowKey, Trade } from "@/lib/market";

/**
 * The About card: the same market read over four windows, then three
 * head-to-head bars.
 *
 * Why four windows rather than one: a token up 48% on the day and down 0.6%
 * in the last five minutes is a completely different trade from one still
 * climbing. The daily figure alone hides the turn, and the turn is the whole
 * decision on a memecoin.
 *
 * Why bars rather than numbers: 3,269 and 1,746 mean nothing side by side
 * until you see which is winning and by how much. The ratio is the signal;
 * the counts are just its evidence.
 */

const LABELS: Record<WindowKey, string> = {
  m5: "5M",
  h1: "1H",
  h6: "6H",
  h24: "24H",
};

const ORDER: WindowKey[] = ["m5", "h1", "h6", "h24"];

function compact(n: number): string {
  if (n >= 1_000_000_000_000) return `${(n / 1_000_000_000_000).toFixed(1)}T`;
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toFixed(0);
}

/**
 * Two quantities as one bar.
 *
 * Both sides are always drawn, even at 0%, so the row keeps its shape — a bar
 * that collapses to nothing reads as a missing panel rather than a lopsided
 * market.
 */
function Versus({
  left,
  right,
  leftLabel,
  rightLabel,
}: {
  left: number;
  right: number;
  leftLabel: string;
  rightLabel: string;
}) {
  const total = left + right;
  // Guard the divide: a pool with no activity in the window has neither side.
  const leftPct = total > 0 ? (left / total) * 100 : 50;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between font-mono text-[11px] tabular-nums">
        <span className="text-green-400">{leftLabel}</span>
        <span className="text-red-400">{rightLabel}</span>
      </div>
      <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-full">
        <div className="bg-green-400/70" style={{ width: `${leftPct}%` }} aria-hidden />
        <div className="flex-1 bg-red-400/50" aria-hidden />
      </div>
    </div>
  );
}

function WindowBox({ k, w }: { k: WindowKey; w: MarketWindow }) {
  const c = w.change;
  return (
    <div className="flex flex-col items-center gap-0.5 rounded-lg border border-champagne/10 bg-ink px-2 py-1.5">
      <span className="font-mono text-[10px] text-ash">{LABELS[k]}</span>
      <span
        className={`font-mono text-xs tabular-nums ${
          c === null ? "text-ash" : c >= 0 ? "text-green-400" : "text-red-400"
        }`}
      >
        {/* Null is "the source did not say", which is not the same as flat. */}
        {c === null ? "—" : `${c >= 0 ? "▲" : "▼"}${Math.abs(c).toFixed(2)}%`}
      </span>
    </div>
  );
}

export function AboutCard({ trades }: { trades: Trade[] }) {
  const { stats } = useLive();
  const day = stats.windows.h24;

  /*
   * Buy vs sell VOLUME, summed from the tape.
   *
   * DexScreener reports total volume per window but never splits it by side,
   * so this cannot come from the same place as the trade counts. The tape can
   * answer it — but only over the trades it actually holds, so the label says
   * so. Presenting this as a 24h figure would be inventing a number.
   */
  const buyVol = trades.reduce(
    (n, t) => (t.side === "buy" ? n + t.volumeUsd : n),
    0,
  );
  const sellVol = trades.reduce(
    (n, t) => (t.side === "sell" ? n + t.volumeUsd : n),
    0,
  );

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-champagne/10 bg-slate p-4">
      <h2 className="font-sans text-sm text-champagne">
        About {stats.symbol}
      </h2>

      <div className="grid grid-cols-4 gap-1.5">
        {ORDER.map((k) => (
          <WindowBox key={k} k={k} w={stats.windows[k]} />
        ))}
      </div>

      <div className="flex flex-col gap-3">
        <Versus
          left={day.buys}
          right={day.sells}
          leftLabel={`${day.buys.toLocaleString()} buys`}
          rightLabel={`${day.sells.toLocaleString()} sells`}
        />
        {/*
          Volume alongside counts, because they disagree in the way that
          matters: a thousand small buys against ten large sells is
          distribution, and the count bar alone would read it as demand.
        */}
        {trades.length > 0 && (
          <div className="flex flex-col gap-1">
            <Versus
              left={buyVol}
              right={sellVol}
              leftLabel={`$${compact(buyVol)} bought`}
              rightLabel={`$${compact(sellVol)} sold`}
            />
            <span className="font-mono text-[9px] text-ash">
              last {trades.length} trades
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
