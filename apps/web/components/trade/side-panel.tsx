"use client";

import { useState } from "react";
import type { Major } from "@/lib/market";
import { MARKETS, marketOf } from "@/lib/market";
import { usd, compactUsd, pct } from "@/lib/format";
import { FeedList, LeaderList } from "./rail";

/**
 * The left panel: a navigator, not a feed.
 *
 * Built to fomo's structure, because on a trading terminal the left column is
 * how you change what you are looking at. Ours was six read-only squawk cards
 * — nothing in it could be clicked to do anything, and cipher had no way to
 * switch markets at all.
 *
 * Four tabs, as they have them. Tokens is the market list and the default;
 * Leaderboard and Feed are cipher's social layer moved into their frame
 * rather than replaced. Alerts is honest about being empty.
 *
 * The panel owns its tab and filter. It does NOT own the selected market —
 * that lives in the terminal, because the chart, the ticket, the websocket
 * and the header all read it. A panel that owned the symbol would have to
 * push it up through three components on every click.
 */

type Tab = "alerts" | "tokens" | "leaders" | "feed";

const TABS: [Tab, string][] = [
  ["alerts", "Alerts"],
  ["tokens", "Tokens"],
  ["leaders", "Leaderboard"],
  ["feed", "Feed"],
];

/**
 * fomo's filter row. Only Crypto returns anything today.
 *
 * Kept visible rather than hidden until they work, because the row is how a
 * trader learns the list is filterable at all — and each one is a query
 * against data cipher will have: Watchlist needs accounts, Trending and Most
 * held need the social backend, Graduating needs the Solana pool index.
 */
const FILTERS = ["Watchlist", "Crypto", "Trending", "Most held", "Graduating"] as const;
type Filter = (typeof FILTERS)[number];

export function SidePanel({
  majors,
  symbol,
  onSelect,
  split,
  onSplit,
  onCollapse,
}: {
  majors: Major[];
  symbol: string;
  onSelect: (symbol: string) => void;
  split: "bottom" | "right";
  onSplit: (s: "bottom" | "right") => void;
  onCollapse: () => void;
}) {
  const [tab, setTab] = useState<Tab>("tokens");
  const [filter, setFilter] = useState<Filter>("Crypto");

  return (
    <section className="flex min-h-0 flex-col rounded-2xl border border-line bg-panel">
      {/* ---- tabs ---- */}
      <div className="flex items-center gap-0.5 border-b border-hairline px-1.5">
        {TABS.map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            aria-selected={tab === k}
            role="tab"
            className={`relative px-2 py-2.5 font-sans text-[11.5px] font-bold transition-colors ${
              tab === k ? "text-champagne" : "text-ash hover:text-champagne"
            }`}
          >
            {k === "alerts" && <span className="mr-1 opacity-70">🔔</span>}
            {label}
            {/* An underline rather than a pill: four tabs in 248px cannot each
                carry a filled background without the row reading as a stack of
                buttons instead of a set of sections. */}
            {tab === k && (
              <span className="absolute inset-x-1.5 -bottom-px h-[2px] rounded-full bg-champagne" />
            )}
          </button>
        ))}
        <button
          onClick={onCollapse}
          aria-label="Collapse panel"
          className="ml-auto px-1.5 py-2 font-mono text-[13px] text-mute transition-colors hover:text-champagne"
        >
          «
        </button>
      </div>

      {tab === "tokens" && (
        <>
          {/* ---- filters ---- */}
          <div className="no-scrollbar flex shrink-0 gap-1 overflow-x-auto px-2 py-2">
            {FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                aria-pressed={filter === f}
                className={`shrink-0 rounded-lg px-2 py-1 font-sans text-[10.5px] font-bold transition-colors ${
                  filter === f
                    ? "bg-raised text-champagne"
                    : "text-ash hover:text-champagne"
                }`}
              >
                {f}
              </button>
            ))}
          </div>

          {/* ---- the fee strip ----
              fomo runs a promo in this slot. Ours states the actual rate
              rather than claiming "lowest", which is a claim we would have to
              keep true against every competitor, forever. */}
          <div className="mx-2 mb-1.5 flex shrink-0 items-center gap-1.5 rounded-lg border border-hairline bg-slate px-2 py-1.5">
            <span className="text-[10px]">🏷</span>
            <span className="font-sans text-[10.5px] text-ash">
              <b className="font-bold text-action">0.50% fees</b> with a referral code
            </span>
          </div>
        </>
      )}

      {/*
        * SCROLLBAR 1 — and it starts HERE, not at the top of the panel.
        *
        * Everything above this is fixed: the tabs, the filter row and the fee
        * strip. Only the list moves, so the bar's track begins level with the
        * fee strip and runs to the split buttons at the bottom — which is
        * exactly where a market list's bar belongs, because scrolling the
        * tabs out of reach to see more rows is a control that fights you.
        */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "tokens" && (
          <TokenList
            majors={majors}
            symbol={symbol}
            onSelect={onSelect}
            filter={filter}
          />
        )}
        {tab === "leaders" && <LeaderList />}
        {tab === "feed" && <FeedList />}
        {tab === "alerts" && (
          <p className="p-4 text-center font-sans text-[11.5px] leading-relaxed text-ash">
            No alerts yet. When the trigger engine lands, every armed rule
            reports here — filled, cancelled, or still waiting.
          </p>
        )}
      </div>

      {/* ---- layout controls ----
          fomo's split buttons, wired to the one split cipher actually has:
          whether the tape sits under the chart or the chart takes the height.
          A control that does nothing is worse than no control. */}
      <div className="flex shrink-0 gap-1 border-t border-hairline p-1.5">
        {(
          [
            ["bottom", "▤", "Split bottom"],
            ["right", "▥", "Split right"],
          ] as const
        ).map(([k, glyph, label]) => (
          <button
            key={k}
            onClick={() => onSplit(k)}
            aria-pressed={split === k}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 font-sans text-[10.5px] font-bold transition-colors ${
              split === k
                ? "bg-raised text-champagne"
                : "text-mute hover:text-champagne"
            }`}
          >
            <span className="font-mono">{glyph}</span>
            {label}
          </button>
        ))}
      </div>
    </section>
  );
}

/**
 * The market list.
 *
 * Two lines per row, as fomo has it: symbol over market cap on the left,
 * price over 24h change on the right. That pairing is deliberate — the two
 * left values are what the thing IS, the two right values are what it is
 * DOING, so the eye can run down either column alone.
 */
function TokenList({
  majors,
  symbol,
  onSelect,
  filter,
}: {
  majors: Major[];
  symbol: string;
  onSelect: (symbol: string) => void;
  filter: Filter;
}) {
  /*
   * The list renders from MARKETS, not from the poll.
   *
   * Prices arrive a beat after the page does, and a list that renders empty
   * and then fills in is a visible flash of nothing on every load. Rows exist
   * immediately with their names, and the numbers land into them.
   */
  if (filter !== "Crypto") {
    return (
      <p className="p-4 text-center font-sans text-[11.5px] leading-relaxed text-ash">
        {filter} needs the social backend. Crypto is live.
      </p>
    );
  }

  const byId = new Map(majors.map((m) => [m.id, m]));

  return (
    <div className="flex flex-col">
      {MARKETS.map((m) => {
        const live = byId.get(m.symbol);
        const selected = m.symbol === symbol;
        const up = (live?.change24h ?? 0) >= 0;

        return (
          <button
            key={m.symbol}
            onClick={() => onSelect(m.symbol)}
            aria-current={selected}
            className={`flex w-full items-center gap-2 border-l-2 px-2.5 py-2 text-left transition-colors ${
              selected
                ? "border-accent bg-raised"
                : "border-transparent hover:bg-slate"
            }`}
          >
            {/* No logo files, so the mark is the brand hue and the token's own
                glyph — enough to find a row by colour, which is how a list
                this long is actually scanned. */}
            <span
              className="grid h-7 w-7 shrink-0 place-items-center rounded-full font-mono text-[12px] font-bold text-ink"
              style={{ background: m.hue }}
            >
              {m.glyph}
            </span>

            <div className="min-w-0 flex-1">
              <div className="truncate font-sans text-[12.5px] font-bold leading-tight">
                {m.base}
              </div>
              <div className="font-sans text-[10px] leading-tight text-mute">
                {live ? `${compactUsd(live.marketCap)} MC` : m.name}
              </div>
            </div>

            <div className="shrink-0 text-right">
              <div className="font-mono text-[12px] font-bold leading-tight tabular-nums">
                {live ? usd(live.priceUsd) : "—"}
              </div>
              <div
                className={`font-mono text-[10px] leading-tight tabular-nums ${
                  !live ? "text-mute" : up ? "text-up" : "text-down"
                }`}
              >
                {live ? pct(live.change24h) : "—"}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

/** Re-exported so the terminal can name the open market without importing two modules. */
export { marketOf };
