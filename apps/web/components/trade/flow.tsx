"use client";

import type { Candle } from "@/lib/market";
import { compactUsd, usd } from "@/lib/format";

/**
 * Order flow, as proportional bars.
 *
 * Two problems at once. The right column ended below the account box, leaving
 * a third of the screen empty — and the terminal had no data *visualisation*
 * anywhere outside the chart, only figures. fomo fills the same space with
 * green-and-red split bars, and that is most of why their page looks like
 * something is happening.
 *
 * Everything here comes from the candles already loaded for the chart. No new
 * request, no mock.
 *
 * cipher: buy/sell pressure is inferred from candle direction, which is the
 * standard approximation when you have bars rather than a trade feed. A green
 * bar's volume is counted as buying. It is directionally right and it is not
 * the same thing as counting taker sides — when the Solana leg has a real
 * swap feed, that replaces this.
 */

const DAY = 86_400;

function Split({
  label,
  left,
  right,
  leftText,
  rightText,
}: {
  label: string;
  left: number;
  right: number;
  leftText: string;
  rightText: string;
}) {
  const total = left + right;
  // A zero total would divide by zero and collapse both bars; an even split
  // reads as "no information", which is what no data means.
  const leftPct = total > 0 ? (left / total) * 100 : 50;

  return (
    <div>
      <div className="flex items-baseline justify-between font-sans text-[11.5px]">
        <span className="font-mono font-bold tabular-nums text-up">{leftText}</span>
        <span className="text-[9px] font-bold uppercase tracking-[0.11em] text-ash">
          {label}
        </span>
        <span className="font-mono font-bold tabular-nums text-down">{rightText}</span>
      </div>
      {/* One track, two children — so the pair always totals the full width
          however lopsided the split, and the eye reads the ratio directly. */}
      <div className="mt-1.5 flex h-1.5 gap-0.5 overflow-hidden rounded-full">
        <div className="rounded-full bg-up" style={{ width: `${leftPct}%` }} />
        <div className="flex-1 rounded-full bg-down" />
      </div>
    </div>
  );
}

export function Flow({ candles, last }: { candles: Candle[]; last: number | undefined }) {
  if (candles.length === 0) return null;

  const cutoff = candles[candles.length - 1].time - DAY;
  const day = candles.filter((c) => c.time >= cutoff);
  // Shorter than a day loaded (1m bars cover ~16h) — say nothing rather than
  // label a partial window "24h".
  if (day.length === 0) return null;

  let buyVol = 0;
  let sellVol = 0;
  let upBars = 0;
  let downBars = 0;
  let high = -Infinity;
  let low = Infinity;

  for (const c of day) {
    const up = c.close >= c.open;
    const usdVol = c.volume * c.close;
    if (up) {
      buyVol += usdVol;
      upBars++;
    } else {
      sellVol += usdVol;
      downBars++;
    }
    if (c.high > high) high = c.high;
    if (c.low < low) low = c.low;
  }

  // Where the current price sits between the day's low and high, as a
  // percentage. This is the one number on the page that answers "is this
  // strong or weak right now" without needing the chart.
  const span = high - low;
  const position = last !== undefined && span > 0 ? ((last - low) / span) * 100 : null;

  return (
    <div className="mt-2 shrink-0 overflow-hidden rounded-xl border border-line bg-slate">
      <div className="flex items-baseline justify-between border-b border-hairline px-3 py-2">
        <h3 className="font-sans text-[10px] font-bold uppercase tracking-[0.11em] text-ash">
          Flow
        </h3>
        <span className="font-mono text-[9.5px] text-ash">last 24h</span>
      </div>

      <div className="flex flex-col gap-3 px-3 py-3">
        <Split
          label="volume"
          left={buyVol}
          right={sellVol}
          leftText={compactUsd(buyVol)}
          rightText={compactUsd(sellVol)}
        />
        <Split
          label="bars"
          left={upBars}
          right={downBars}
          leftText={String(upBars)}
          rightText={String(downBars)}
        />

        {position !== null && (
          <div>
            <div className="flex items-baseline justify-between font-sans text-[11.5px]">
              <span className="font-mono tabular-nums text-ash">{usd(low)}</span>
              <span className="text-[9px] font-bold uppercase tracking-[0.11em] text-ash">
                range
              </span>
              <span className="font-mono tabular-nums text-ash">{usd(high)}</span>
            </div>
            {/* A track with a marker rather than a filled bar: position in a
                range is a point, not a quantity, and a fill would imply the
                latter. */}
            <div className="relative mt-1.5 h-1.5 rounded-full bg-gradient-to-r from-down/50 via-ash/30 to-up/50">
              <span
                className="absolute top-1/2 h-3 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-champagne"
                style={{ left: `${position}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
