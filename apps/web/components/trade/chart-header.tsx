"use client";

import { useEffect, useState } from "react";
import { CoinMark } from "./coin-mark";
import type { Denom } from "@/lib/chain/denom";
import type { Interval, MarketDef } from "@/lib/market";
import { offsetLabel, offsetMinutes } from "@/lib/tz";
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
  icon,
  price,
  marketCap,
  change,
  volumeUsd,
  depthUsd,
  interval,
  onInterval,
  pending,
  denom,
  onDenom,
  canMcap,
  zone,
  onZone,
}: {
  market: MarketDef;
  /** The token's own icon, for a market that is a mint rather than a pair. */
  icon?: string | null;
  price: number | undefined;
  marketCap: number | null;
  change: number | null;
  volumeUsd: number | null;
  depthUsd: number | null;
  interval: Interval;
  denom: Denom;
  onDenom: (d: Denom) => void;
  /** False when nothing behind the chart has a supply to multiply by. */
  canMcap: boolean;
  /** Which zone the axis is drawn in. Null until the browser reports one. */
  zone: string | null;
  onZone: (z: string) => void;
  onInterval: (i: Interval) => void;
  pending: boolean;
}) {
  const [starred, setStarred] = useState(false);

  return (
    <div className="shrink-0">
      {/* ---------------- row 1: identity and readings ---------------- */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-hairline px-3 py-2">
        {/* The same mark the list rows use, so clicking a row does not change
            what the coin looks like. */}
        <CoinMark symbol={market.base} icon={icon} hue={market.hue} glyph={market.glyph} size={32} />

        <div className="mr-1">
          <div className="flex items-center gap-1.5">
            {/* THE SANS, because the ticker is uppercase and Caacupe One draws its
                capital A as a single-storey lowercase form: PAID renders "PaID"
                and SANA renders "SaNa". Same reason the About heading uses it.
                font-bold also went: the face is single-weight, so bold was
                synthesised, which smeared the glyphs further. */}
            <h1 className="font-sans text-[17px] font-bold leading-none tracking-tight">
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
          * PRICE / MARKET CAP, and it is a real toggle now.
          *
          * This was a single static "Price" label, with a comment explaining
          * that fomo's version of it "would set a label and change nothing"
          * here — true at the time, because there was no supply figure to
          * multiply by. Jupiter reports `fdv` and `priceUsd` on every token
          * and their ratio is the supply, so the second option now redraws
          * the axis against a real number. See lib/chain/denom.ts.
          *
          * MCap disappears rather than greys out when there is nothing behind
          * the chart. A Binance major has no token and therefore no cap; a
          * disabled control invites a click and then explains itself, and one
          * tab is not a choice — the same rule that removed this control's
          * first version.
          */}
        {canMcap ? (
          <div className="flex items-center gap-0.5 rounded-md bg-slate p-0.5">
            {(["price", "mcap"] as const).map((d) => (
              <button
                key={d}
                onClick={() => onDenom(d)}
                aria-pressed={denom === d}
                className={`rounded px-1.5 py-0.5 font-sans text-[10.5px] font-bold transition-colors ${
                  denom === d ? "bg-raised text-champagne" : "text-mute hover:text-ash"
                }`}
              >
                {d === "price" ? "Price" : "MCap"}
              </button>
            ))}
          </div>
        ) : (
          <span className="font-sans text-[10.5px] font-bold text-action">Price</span>
        )}

        {pending && <span className="font-mono text-[10.5px] text-mute">loading…</span>}

        {/*
          * WHICH CLOCK THE AXIS IS DRAWN IN.
          *
          * The chart renders bars in local wall-clock time so the date on the
          * right edge matches the reader's own — see price-chart.tsx. That
          * makes the labels correct and the FRAME implicit, and a time axis
          * whose frame you have to guess is the thing that made this
          * ambiguous in the first place. fomo prints "10:39:04 UTC" here for
          * the same reason, having made the opposite choice.
          */}
        <TimeZoneBadge zone={zone} onZone={onZone} />

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

/**
 * THE ZONES ON OFFER, in TradingView's own order.
 *
 * Their picker leads with UTC and "Exchange", then walks the world west to
 * east. "Exchange" is dropped: it means the venue's local time, and a Solana
 * AMM has no venue and no floor that opens — offering it would be a control
 * that either does nothing or quietly means UTC.
 *
 * The labels carry the offset because that is what a trader is actually
 * choosing, and the offsets are RENDERED FROM THE ZONE rather than typed in.
 * A hardcoded "(UTC-8) Los Angeles" is wrong for eight months of the year;
 * Intl knows when the clocks change and this does not.
 */
const ZONES = [
  "UTC",
  "Pacific/Honolulu",
  "America/Anchorage",
  "America/Juneau",
  "America/Los_Angeles",
  "America/Phoenix",
  "America/Vancouver",
  "America/Denver",
  "America/Mexico_City",
  "America/El_Salvador",
  "America/Bogota",
  "America/Chicago",
  "America/New_York",
  "America/Toronto",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "Europe/Zurich",
  "Europe/Athens",
  "Europe/Moscow",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Bangkok",
  "Asia/Shanghai",
  "Asia/Hong_Kong",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Australia/Sydney",
  "Pacific/Auckland",
];

/** The city, without the continent Intl insists on carrying around. */
function cityOf(zone: string): string {
  return zone === "UTC" ? "UTC" : (zone.split("/").pop() ?? zone).replace(/_/g, " ");
}

/**
 * THE ZONE THE AXIS IS DRAWN IN, and the control that changes it.
 *
 * Bold, because it is a control rather than a caption — it was a dim grey
 * label and read as a footnote nobody could act on.
 *
 * Mounted empty and filled in an effect: the server has no timezone to read,
 * so rendering it during SSR would print the deployment's offset and correct
 * itself on hydration — a mismatch React throws the subtree away for, and a
 * wrong claim about the axis in the meantime.
 */
function TimeZoneBadge({ zone, onZone }: { zone: string | null; onZone: (z: string) => void }) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState<string>("");

  /* The clock in the button, so the zone is not an abstract label — you can
     see whether it says what your wall clock says. */
  useEffect(() => {
    if (!zone) return;
    const tick = () =>
      setNow(
        new Intl.DateTimeFormat("en-GB", {
          timeZone: zone === "UTC" ? "UTC" : zone,
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }).format(new Date()),
      );
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [zone]);

  /* Click anywhere else to dismiss. A menu that can only be closed by
     choosing something is a menu you cannot back out of. */
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  if (!zone) return null;
  const mins = offsetMinutes(zone);

  return (
    <div className="relative" onPointerDown={(e) => e.stopPropagation()}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="The time zone the chart's axis is drawn in"
        className={`rounded-md px-1.5 py-0.5 font-mono text-[11px] font-bold transition-colors ${
          open ? "bg-raised text-champagne" : "text-ash hover:text-champagne"
        }`}
      >
        {now} UTC{offsetLabel(mins)}
      </button>

      {open && (
        <div
          role="listbox"
          /*
           * data-wheel-lock: the menu owns the wheel over itself.
           *
           * Without it, scrolling to reach a zone scrolled the PAGE instead —
           * the terminal's right-hand scroller saw the event and moved the
           * whole column, so the only way down the list was to drag its bar.
           * The chart canvas already claims the wheel the same way; see
           * Scroller, which checks for this attribute before acting.
           */
          data-wheel-lock
          onWheel={(e) => e.stopPropagation()}
          className="absolute left-0 top-full z-50 mt-1 max-h-[320px] w-[230px] overflow-y-auto overscroll-contain rounded-lg border border-line bg-panel py-1 shadow-xl shadow-black/50"
        >
          {ZONES.map((z) => {
            const m = offsetMinutes(z);
            const on = z === zone;
            return (
              <button
                key={z}
                role="option"
                aria-selected={on}
                onClick={() => {
                  onZone(z);
                  setOpen(false);
                }}
                className={`flex w-full items-baseline gap-2 px-3 py-1.5 text-left font-sans text-[13px] transition-colors ${
                  on ? "bg-raised text-champagne" : "text-ash hover:bg-slate hover:text-champagne"
                }`}
              >
                {z !== "UTC" && (
                  <span className="shrink-0 font-mono text-[11.5px] text-mute">
                    (UTC{offsetLabel(m)})
                  </span>
                )}
                <span className="truncate">{cityOf(z)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
