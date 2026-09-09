"use client";

import { useState } from "react";
import type { Interval, MarketDef } from "@/lib/market";
import { INTERVAL_ORDER } from "@/lib/market";
import { usd, compactUsd, pct } from "@/lib/format";

/**
 * Everything above the candles, laid out the way fomo lays it out.
 *
 * Three rows, and the separation matters:
 *
 *   1. IDENTITY + READINGS — what this is, and what it is doing. Never
 *      interactive except the star.
 *   2. CHART TOOLS — interval, indicators, the price/mcap toggle. Everything
 *      that changes how the chart is DRAWN.
 *   3. OVERLAYS — what gets drawn ON the chart on top of price. Separated
 *      from row 2 because these are social, not technical, and they are the
 *      whole reason cipher's chart has faces on it.
 *
 * Pulled out of terminal.tsx, which was 363 lines and holding the layout, the
 * data fetching, the account header and this. Header markup is the part that
 * changes most often, so it is the part that should not live inside the file
 * that owns the websocket.
 */

export interface Overlays {
  mySwaps: boolean;
  thesis: boolean;
  friendsOnly: boolean;
  minSize: boolean;
}

export const DEFAULT_OVERLAYS: Overlays = {
  mySwaps: true,
  thesis: true,
  friendsOnly: false,
  minSize: false,
};

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
  overlays,
  onOverlays,
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
  overlays: Overlays;
  onOverlays: (o: Overlays) => void;
}) {
  const [starred, setStarred] = useState(false);
  /** Price or market cap on the axis. fomo's Price/MCap toggle. */
  const [scale, setScale] = useState<"price" | "mcap">("price");

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
            {market.name} · live
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
          <div className="text-right">
            <div className="font-sans text-[8.5px] font-bold uppercase tracking-[0.11em] text-ash">
              Price
            </div>
            <div className="font-mono text-[17px] font-bold leading-tight tabular-nums">
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
            <Stat label="24H vol." value={compactUsd(volumeUsd)} />
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
          * Price / MCap.
          *
          * Real, not decorative: on a memecoin these are the same series eight
          * orders of magnitude apart, and traders argue in market cap while
          * charts are drawn in price. The chart's own axis formatter already
          * handles both magnitudes — see precisionFor in price-chart.tsx.
          *
          * cipher: the toggle sets the label today. Multiplying the series by
          * supply lands with the pool index, when supply is a field rather
          * than a hardcoded table.
          */}
        <div className="flex items-center gap-1 font-sans text-[10.5px] font-bold">
          {(["price", "mcap"] as const).map((k, i) => (
            <span key={k} className="flex items-center">
              {i === 1 && <span className="px-1 text-mute">/</span>}
              <button
                onClick={() => setScale(k)}
                aria-pressed={scale === k}
                className={`transition-colors ${
                  scale === k ? "text-action" : "text-ash hover:text-champagne"
                }`}
              >
                {k === "price" ? "Price" : "MCap"}
              </button>
            </span>
          ))}
        </div>

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

      {/* ---------------- row 3: chart overlays ---------------- */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-hairline px-3 py-1.5">
        <span className="font-sans text-[10px] font-bold uppercase tracking-[0.11em] text-mute">
          Chart overlays
        </span>
        <Check
          label="My swaps"
          on={overlays.mySwaps}
          onChange={(v) => onOverlays({ ...overlays, mySwaps: v })}
        />
        <Check
          label="Thesis"
          on={overlays.thesis}
          onChange={(v) => onOverlays({ ...overlays, thesis: v })}
        />
        <Check
          label="Friends only"
          on={overlays.friendsOnly}
          onChange={(v) => onOverlays({ ...overlays, friendsOnly: v })}
        />
        <Check
          label="Min size (>$1K)"
          on={overlays.minSize}
          onChange={(v) => onOverlays({ ...overlays, minSize: v })}
        />
      </div>
    </div>
  );
}

/**
 * One boxed reading.
 *
 * Bordered and raised rather than loose text, because the same figures sat
 * unboxed in the old header and read as labels rather than as live numbers. A
 * border and a surface say "this is an instrument".
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
    <div
      className={`min-w-[76px] rounded-lg border px-2.5 py-1 text-right ${
        dir === "up"
          ? "border-up/30 bg-up/10"
          : dir === "down"
            ? "border-down/30 bg-down/10"
            : "border-line bg-raised"
      }`}
    >
      <div className="font-sans text-[8.5px] font-bold uppercase tracking-[0.11em] text-ash">
        {label}
      </div>
      <div
        className={`font-mono text-[13px] font-bold leading-tight tabular-nums ${
          dir === "up" ? "text-up" : dir === "down" ? "text-down" : "text-champagne"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

/** fomo's overlay checkboxes: a real input, styled, never a div pretending. */
function Check({
  label,
  on,
  onChange,
}: {
  label: string;
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer select-none items-center gap-1.5 font-sans text-[11px] text-ash transition-colors hover:text-champagne">
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      {/* The box is drawn here rather than by the browser so it can carry the
          theme, but the input above is a real checkbox — so it keeps keyboard
          focus, the space key, and the label click for free. */}
      <span
        aria-hidden
        className={`grid h-3.5 w-3.5 place-items-center rounded-[4px] border text-[9px] font-bold transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-accent ${
          on ? "border-action bg-action text-white" : "border-line bg-slate text-transparent"
        }`}
      >
        ✓
      </span>
      {label}
    </label>
  );
}
