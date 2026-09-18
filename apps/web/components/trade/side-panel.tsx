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
import { useSolPrices, type Mark } from "./sol-prices";
import { displayCap, type Lifecycle } from "@/lib/chain/tokens";

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
    <section className="panel flex min-h-0 flex-col overflow-hidden rounded-2xl border border-line bg-ink">
      {/* ---- tabs ---- */}
      <div className="panel__nav">
        {TABS.map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            aria-selected={tab === k}
            role="tab"
            className="navtab"
          >
            {k === "alerts" && <span className="opacity-70">🔔</span>}
            {label}
            {/* An underline rather than a pill: four tabs in 248px cannot each
                carry a filled background without the row reading as a stack of
                buttons instead of a set of sections. */}
          </button>
        ))}
        <button
          onClick={onCollapse}
          aria-label="Collapse panel"
          className="panel__collapse font-mono text-[15px]"
        >
          «
        </button>
      </div>

      {tab === "tokens" && (
        <>
          {/* ---- filters ---- */}
          <div className="panel__chips no-scrollbar shrink-0 overflow-x-auto">
            {FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                aria-pressed={filter === f}
                className="chip"
              >
                {f}
              </button>
            ))}
          </div>

          {/* ---- the fee strip ----
              fomo runs a promo in this slot. Ours states the actual rate
              rather than claiming "lowest", which is a claim we would have to
              keep true against every competitor, forever. */}
          <div className="promo shrink-0">
            <span className="text-[13px]">🏷</span>
            <span>
              <b>0.50% fees</b> with a referral code
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
      <div className="panel__foot shrink-0">
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
            className="split"
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

  return <Rows tokens={universe.tokens} symbol={symbol} onSelect={onSelect} />;
}

/**
 * The rows, priced from the SHARED feed rather than from the token list.
 *
 * The discover response carries a price, and using it was the obvious thing —
 * it is right there, it costs nothing extra, and it is fifteen seconds old
 * from a different endpoint than the chart header polls. So SOL read $100.74
 * here and $100.77 four inches to the right, at the same instant.
 *
 * The list price now comes from the same object the header reads, so the two
 * move together or not at all. The discover price is kept only as the value
 * to show before the first poll lands — better a number a few seconds stale
 * than a dash where a price should be.
 *
 * Split into its own component because the hook registers the visible mints,
 * and hooks cannot sit behind the early returns above.
 */
function Rows({
  tokens,
  symbol,
  onSelect,
}: {
  tokens: UniverseToken[];
  symbol: string;
  onSelect: (symbol: string) => void;
}) {
  const marks = useSolPrices(
    "market-list",
    tokens.map((t) => t.mint),
  );

  return (
    <div className="flex flex-col">
      {tokens.map((t) => (
        <TokenRow
          key={t.mint}
          token={t}
          mark={marks[t.mint] ?? null}
          selected={t.mint === symbol}
          onSelect={() => onSelect(t.mint)}
        />
      ))}
    </div>
  );
}

function TokenRow({
  token,
  mark,
  selected,
  onSelect,
}: {
  token: UniverseToken;
  /** The live price, once the shared poll has one. */
  mark: Mark | null;
  selected: boolean;
  onSelect: () => void;
}) {
  /* The live feed wins wherever it has an answer. Both numbers come from the
     same response, so the price and the change can never disagree about which
     moment they describe. */
  const price = mark?.usd ?? token.priceUsd;
  const change = mark ? mark.change24h : token.change24h;
  const up = (change ?? 0) >= 0;

  return (
    <button
      onClick={onSelect}
      aria-current={selected}
      /* Geometry from the reference: a 36px mark, a 12px gap, the symbol over
         the cap on the left and the price over the change on the right, with a
         rule under every row. Height is the one divergence — see --p-row. */
      className="token-row"
    >
      <CoinMark symbol={token.symbol} icon={token.icon} size={36} />

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-1.5">
          <span className="token__sym truncate">{token.symbol || "?"}</span>
          {/* The badge is the point of the list. A token still on its curve
              and a token with a real pool behind it are different
              instruments, and nothing else on the row says which. */}
          <Stage token={token} />
        </div>
        <div className="token__mc truncate">
          {displayCap(token) ? `${compactUsd(displayCap(token))} MC` : token.name || "—"}
        </div>
      </div>

      <div className="ml-auto flex shrink-0 flex-col items-end gap-0.5 text-right">
        <div className="token__price tabular-nums">{price ? usd(price) : "—"}</div>
        <div
          className={`token__chg tabular-nums ${
            change === null ? "text-mute" : up ? "text-up" : "text-down"
          }`}
        >
          {change === null ? "—" : pct(change)}
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
            className="token-row"
          >
            {/* The SAME component the Solana rows use, so SOL is the same
                Solana logo in Majors as it is in Trending — the same file,
                not a matching one. */}
            <CoinMark symbol={m.base} hue={m.hue} glyph={m.glyph} size={36} />

            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="token__sym truncate">{m.base}</div>
              <div className="token__mc truncate">
                {live ? `${compactUsd(live.marketCap)} MC` : m.name}
              </div>
            </div>

            <div className="ml-auto flex shrink-0 flex-col items-end gap-0.5 text-right">
              <div className="token__price tabular-nums">
                {live ? usd(live.priceUsd) : "—"}
              </div>
              <div
                className={`token__chg tabular-nums ${
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
