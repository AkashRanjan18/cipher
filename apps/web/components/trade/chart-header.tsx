"use client";

import { useState } from "react";
import type { Interval, MarketDef } from "@/lib/market";
import { INTERVAL_ORDER } from "@/lib/market";
import { usd, compactUsd, pct } from "@/lib/format";

/**
 * Everything above the candles, laid out the way fomo lays it out.
 *
 * Two rows, and the separation matters:
 *
 *   1. IDENTITY + READINGS — what this is, and what it is doing. Never
 *      interactive except the star.
 *   2. CHART TOOLS — everything that changes how the chart is DRAWN.
 *
 * A third row of overlay checkboxes lived here and is gone with the invented
 * chart markers it filtered.
 *
 * Typography follows fomo exactly: the readings are labelled in SENTENCE case
 * at a readable size, not in tracked-out caps. Caps at 8.5px reads as chrome —
 * something the interface is saying about itself — and these are the numbers
 * you are actually here to look at.
 *
 * Pulled out of terminal.tsx, which was 363 lines and holding the layout, the
 * data fetching, the account header and this. Header markup is the part that
 * changes most often, so it is the part that should not live inside the file
 * that owns the websocket.
 */

export function ChartHeader({
  market,
  price,
  marketCap,
  change,
  volumeUsd,
  depthUsd,
  interval,
  onInterval,
  pending,
}: {
  market: MarketDef;
  price: number | undefined;
  marketCap: number | null;
  change: number | null;
  volumeUsd: number | null;
  depthUsd: number | null;
  interval: Interval;
  onInterval: (i: Interval) => void;
  pending: boolean;
}) {
  const [starred, setStarred] = useState(false);

  return (
    <div className="shrink-0">
      {/* ---------------- row 1: identity and readings ---------------- */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-hairline px-3 py-2">
        <span
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full font-mono text-sm font-bold text-ink"
          style={{ background: market.hue }}
        >
          {market.glyph}
        </span>

        <div className="mr-1">
          <div className="flex items-center gap-1.5">
            <h1 className="font-display text-[17px] font-bold leading-none tracking-tight">
              {market.base}
            </h1>
            <button
              onClick={() => setStarred((s) => !s)}
              aria-pressed={starred}
              aria-label="Watchlist"
              className={`text-[12px] leading-none transition-colors ${
                starred ? "text-accent" : "text-mute hover:text-champagne"
              }`}
            >
              {starred ? "★" : "☆"}
            </button>
          </div>
          <p className="mt-1 font-sans text-[10px] leading-none text-ash">
            {/* A token whose name IS its ticker read "NTDA · NTDA · live".
                Saying it twice is not more informative than saying it once. */}
            {market.name && market.name !== market.base ? `${market.name} · live` : "live"}
          </p>
        </div>

        {/*
          * Price sits OUTSIDE the boxes and one size larger.
          *
          * fomo does this and it is the right call: the four boxed figures are
          * context you consult, the price is the number you are watching.
          * Boxing all five gives them equal weight and the eye has nowhere to
          * land.
          */}
        <div className="ml-auto flex items-center gap-3">
          <div className="px-1 text-center">
            <div className="font-sans text-[11px] text-ash">Price</div>
            <div className="font-mono text-[19px] font-bold leading-tight tabular-nums">
              {price ? usd(price) : "—"}
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <Stat label="Market cap" value={compactUsd(marketCap)} />
            <Stat
              label="24H change"
              value={pct(change)}
              dir={change === null ? null : change >= 0 ? "up" : "down"}
            />
            <Stat label="24H Vol." value={compactUsd(volumeUsd)} />
            <Stat label="Liquidity" value={compactUsd(depthUsd)} />
          </div>
        </div>
      </div>

      {/* ---------------- row 2: chart tools ---------------- */}
      <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-3 py-1.5">
        <div className="flex gap-0.5 rounded-lg bg-slate p-0.5">
          {INTERVAL_ORDER.map((i) => (
            <button
              key={i}
              onClick={() => onInterval(i)}
              aria-pressed={i === interval}
              className={`rounded-md px-2 py-0.5 font-mono text-[10.5px] transition-colors ${
                i === interval ? "bg-raised text-champagne" : "text-ash hover:text-champagne"
              }`}
            >
              {i}
            </button>
          ))}
        </div>

        <span className="h-4 w-px bg-hairline" />

        {/*
          * Price only.
          *
          * fomo has a Price / MCap toggle here. Ours would set a label and
          * change nothing — the series is drawn in price either way — so the
          * option is not offered. MCap arrives with the pool index, when
          * supply is a field rather than the hardcoded table in markets.ts.
          */}
        <span className="font-sans text-[10.5px] font-bold text-action">Price</span>

        {pending && <span className="font-mono text-[10.5px] text-mute">loading…</span>}

        <div className="ml-auto flex items-center gap-2.5 font-mono text-[12px] text-mute">
          {/* fomo's tool cluster. Labelled for screen readers even though the
              glyphs are the whole control — an icon row with no names is the
              most common accessibility failure on a trading screen. */}
          {(
            [
              ["Indicators", "ƒx"],
              ["Alert", "◔"],
              ["Fullscreen", "⛶"],
              ["Snapshot", "▣"],
            ] as const
          ).map(([label, glyph]) => (
            <button
              key={label}
              aria-label={label}
              title={label}
              className="transition-colors hover:text-champagne"
            >
              {glyph}
            </button>
          ))}
        </div>
      </div>

    </div>
  );
}

/**
 * One boxed reading.
 *
 * Every box is the same surface, including the one showing direction. fomo
 * does this and it is right: tinting the 24H-change box red made it the
 * loudest object in the header, so the eye landed on the least important of
 * the five numbers. Direction is carried by the VALUE's colour, which is
 * enough — it is the only coloured text in the row.
 */
function Stat({
  label,
  value,
  dir,
}: {
  label: string;
  value: string;
  dir?: "up" | "down" | null;
}) {
  return (
    <div className="min-w-[86px] rounded-[10px] border border-line bg-slate px-3 py-1 text-center">
      <div className="whitespace-nowrap font-sans text-[11px] text-ash">{label}</div>
      <div
        className={`font-mono text-[14px] font-bold leading-tight tabular-nums ${
          dir === "up" ? "text-up" : dir === "down" ? "text-down" : "text-champagne"
        }`}
      >
        {value}
      </div>
    </div>
  );
}
