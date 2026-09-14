"use client";

import { useState } from "react";
import type { Major } from "@/lib/market";
import { MARKETS, marketOf } from "@/lib/market";
import { usd, compactUsd, pct } from "@/lib/format";
import { FeedList, LeaderList } from "./rail";
import { Scroller } from "@/components/ui/scroller";
import { AlertsList } from "./alerts";
import { useUniverse, type Feed, type UniverseToken } from "./use-universe";
import { CoinMark } from "./coin-mark";
import type { Lifecycle } from "@/lib/chain/tokens";

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
 * THE FILTER ROW IS NOW THE WHOLE OF SOLANA, not fourteen hardcoded pairs.
 *
 * Every entry except Majors and Watchlist is a live query against
 * /api/discover, which is Jupiter's token universe split by where each token
 * is in its life. This row is the answer to "why am I looking at fifteen
 * coins on a chain with hundreds of thousands".
 *
 *   Trending    organic score — real activity with wash trading stripped out
 *   Volume      24h leaders, whatever is actually moving money
 *   New         minted in the last minutes, still on a bonding curve
 *   Graduated   filled its curve and migrated to a real pool
 *   Majors      the Binance fourteen. Kept because they are the only markets
 *               with years of clean candles, and because SOL is the one asset
 *               the ledger can currently hold.
 *   Watchlist   still needs a per-user list. Honestly empty rather than hidden.
 */
const FILTERS = [
  "Trending",
  "Volume",
  "New",
  "Graduated",
  "Majors",
  "Watchlist",
] as const;
type Filter = (typeof FILTERS)[number];

/** Which feed and which stage each filter asks for. Null = not a live query. */
const QUERY: Record<Filter, { feed: Feed; stage: Lifecycle | null } | null> = {
  Trending: { feed: "organic", stage: null },
  Volume: { feed: "traded", stage: null },
  New: { feed: "new", stage: "bonding" },
  Graduated: { feed: "traded", stage: "graduated" },
  Majors: null,
  Watchlist: null,
};

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
  const [filter, setFilter] = useState<Filter>("Trending");

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
        * The market list scrolls; everything above it does not.
        *
        * The tabs, the filter row and the fee strip stay put, so the bar only
        * exists alongside the rows — scrolling the tabs out of reach to see
        * more markets is a control that fights you.
        */}
      <Scroller className="min-h-0 flex-1">
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
        {tab === "alerts" && <AlertsList />}
      </Scroller>

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
 *
 * Rows are keyed and selected by MINT, not by symbol, everywhere except the
 * Majors list. Anyone can mint a token called BONK for a couple of dollars;
 * the mint is the only identifier that cannot be forged, and a list built to
 * show unverified launches is exactly where that stops being academic.
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
  const query = QUERY[filter];
  /*
   * The hook runs unconditionally and is handed a fallback feed when the
   * filter is not a live query. Hooks cannot sit behind a branch, and the
   * cost is nil — the route caches, and both static filters return before
   * the result is ever read.
   */
  const universe = useUniverse(query?.feed ?? "organic", query?.stage ?? null);

  if (filter === "Majors") {
    return <MajorList majors={majors} symbol={symbol} onSelect={onSelect} />;
  }

  if (filter === "Watchlist") {
    return (
      <p className="p-4 text-center font-sans text-[11.5px] leading-relaxed text-ash">
        A watchlist needs somewhere to keep it. Signing in gives you one.
      </p>
    );
  }

  if (universe.error) {
    return (
      <p className="p-4 text-center font-sans text-[11.5px] leading-relaxed text-ash">
        {universe.error}
      </p>
    );
  }

  /* Nothing yet is not the same as nothing there. */
  if (!universe.loaded) {
    return <p className="p-4 text-center font-sans text-[11.5px] text-mute">Loading Solana…</p>;
  }

  if (universe.tokens.length === 0) {
    return (
      <p className="p-4 text-center font-sans text-[11.5px] leading-relaxed text-ash">
        Nothing in this feed right now.
      </p>
    );
  }

  return (
    <div className="flex flex-col">
      {universe.tokens.map((t) => (
        <TokenRow
          key={t.mint}
          token={t}
          selected={t.mint === symbol}
          onSelect={() => onSelect(t.mint)}
        />
      ))}
    </div>
  );
}

function TokenRow({
  token,
  selected,
  onSelect,
}: {
  token: UniverseToken;
  selected: boolean;
  onSelect: () => void;
}) {
  const up = (token.change24h ?? 0) >= 0;

  return (
    <button
      onClick={onSelect}
      aria-current={selected}
      className={`flex w-full items-center gap-2 border-l-2 px-2.5 py-2 text-left transition-colors ${
        selected ? "border-accent bg-raised" : "border-transparent hover:bg-slate"
      }`}
    >
      <CoinMark symbol={token.symbol} icon={token.icon} />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <span className="truncate font-sans text-[12.5px] font-bold leading-tight">
            {token.symbol || "?"}
          </span>
          {/* The badge is the point of the list. A token still on its curve
              and a token with a real pool behind it are different
              instruments, and nothing else on the row says which. */}
          <Stage token={token} />
        </div>
        <div className="truncate font-sans text-[10px] leading-tight text-mute">
          {token.mcap ? `${compactUsd(token.mcap)} MC` : token.name || "—"}
        </div>
      </div>

      <div className="shrink-0 text-right">
        <div className="font-mono text-[12px] font-bold leading-tight tabular-nums">
          {token.priceUsd ? usd(token.priceUsd) : "—"}
        </div>
        <div
          className={`font-mono text-[10px] leading-tight tabular-nums ${
            token.change24h === null ? "text-mute" : up ? "text-up" : "text-down"
          }`}
        >
          {token.change24h === null ? "—" : pct(token.change24h)}
        </div>
      </div>
    </button>
  );
}

/**
 * Where the token is in its life, and whether anything is wrong with it.
 *
 * Bonding is marked in the DOWN colour rather than a neutral one because it
 * is a warning: there is no pool, the only counterparty is the curve, and the
 * number beside it is not a market price in the way the others are.
 */
function Stage({ token }: { token: UniverseToken }) {
  if (token.lifecycle === "legacy") {
    return token.verified ? (
      <span className="shrink-0 font-sans text-[9px] font-bold text-action" title="Verified">
        ✓
      </span>
    ) : null;
  }
  const bonding = token.lifecycle === "bonding";
  return (
    <span
      title={
        bonding
          ? token.warnings.join(" ") || `On its bonding curve (${token.launchpad})`
          : `Graduated from ${token.launchpad}`
      }
      className={`shrink-0 rounded px-1 font-sans text-[8.5px] font-bold uppercase leading-[14px] ${
        bonding ? "bg-down/20 text-down" : "bg-up/15 text-up"
      }`}
    >
      {bonding ? "bond" : "grad"}
    </span>
  );
}

/**
 * The Binance fourteen, unchanged.
 *
 * Kept as its own filter rather than deleted: they are the only markets with
 * years of clean candles behind them, and SOL is still the one asset the
 * ledger can hold. This list shrinks to nothing the day the ledger holds
 * positions by mint.
 */
function MajorList({
  majors,
  symbol,
  onSelect,
}: {
  majors: Major[];
  symbol: string;
  onSelect: (symbol: string) => void;
}) {
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
              selected ? "border-accent bg-raised" : "border-transparent hover:bg-slate"
            }`}
          >
            {/* The SAME component the Solana rows use, so SOL is the same
                Solana logo in Majors as it is in Trending — the same file,
                not a matching one. */}
            <CoinMark symbol={m.base} hue={m.hue} glyph={m.glyph} />

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
