"use client";

import type { Major } from "@/lib/market";
import { CoinMark } from "./coin-mark";
import { MARKETS } from "@/lib/market";
import { usd, pct } from "@/lib/format";

/**
 * The bar along the bottom, as fomo has it: live prices on the left, service
 * status and the legal links on the right.
 *
 * The prices are the point. A terminal shows one market at a time, and this
 * strip is the only thing on the page that says what the rest of the market
 * is doing — which is what stops you from buying into a chart that is green
 * on a day everything else is red.
 *
 * cipher's social ticker was its own bar above this one; the two were merged
 * into one scroller, and the social half was then removed as invented (28 Sep
 * 2026). What is left is prices.
 */

/** Only the majors everyone watches. Fourteen rows down here is a list, not a strip. */
const TICKER = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"];

export function StatusBar({
  majors,
  onSelect,
}: {
  majors: Major[];
  onSelect: (symbol: string) => void;
}) {
  const byId = new Map(majors.map((m) => [m.id, m]));

  return (
    <div className="flex h-8 shrink-0 items-center gap-0 overflow-hidden rounded-xl border border-line bg-panel">
      <div className="no-scrollbar flex min-w-0 flex-1 items-center overflow-x-auto">
        {TICKER.map((id) => {
          const def = MARKETS.find((m) => m.symbol === id);
          const live = byId.get(id);
          if (!def) return null;
          const up = (live?.change24h ?? 0) >= 0;

          return (
            <button
              key={id}
              onClick={() => onSelect(id)}
              className="flex shrink-0 items-center gap-1.5 border-r border-hairline px-3 transition-colors hover:bg-slate"
            >
              <CoinMark symbol={def.base} hue={def.hue} glyph={def.glyph} size={14} />
              <span className="font-mono text-[11px] font-bold tabular-nums">
                {live ? usd(live.priceUsd) : "—"}
              </span>
              <span
                className={`font-mono text-[10px] tabular-nums ${
                  !live ? "text-mute" : up ? "text-up" : "text-down"
                }`}
              >
                {live ? pct(live.change24h) : ""}
              </span>
            </button>
          );
        })}

        {/* The social tape that followed the prices here was invented —
            "@vex sold the bottom again", people who did not exist. Removed on
            the user's call, 28 Sep 2026 (CLAUDE.md: never render invented
            social proof). Real public trades can fill this once the feed
            exists; until then the strip is prices, which are real. */}
      </div>

      {/* Right side never scrolls. Status and the legal links have to be
          reachable without dragging a ticker out of the way. */}
      <div className="flex shrink-0 items-center gap-3 border-l border-hairline px-3 font-sans text-[10.5px] text-mute">
        <span className="flex items-center gap-1.5">
          {/*
            * cipher: hardcoded "Stable". It should read a health endpoint —
            * the Binance socket's connection state is already known in
            * subscribeCandles and is the honest source for it.
            */}
          <span className="h-1.5 w-1.5 rounded-full bg-up" />
          <span className="text-ash">Stable</span>
        </span>
        {["Privacy", "Terms", "Help"].map((l) => (
          <a key={l} href="#" className="transition-colors hover:text-champagne">
            {l}
          </a>
        ))}
      </div>
    </div>
  );
}
