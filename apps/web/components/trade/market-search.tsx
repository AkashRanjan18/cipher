"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CoinMark } from "./coin-mark";
import { MARKETS } from "@/lib/market";
import { displayCap, type TokenInfo } from "@/lib/chain/tokens";
import { compactUsd } from "@/lib/format";

/**
 * The search bar across the top: every token cipher is showing, in one place.
 *
 * IT SEARCHED THREE COINS. Its list was MARKETS, which is the majors — and
 * once those became SOL, BTC and ETH, typing "bonk" or "pump" found nothing,
 * while both sat in the left panel a few hundred pixels away. A search box
 * that cannot find what is on screen is worse than no search box.
 *
 * So it searches the UNION of every list the panel can show: the majors, plus
 * the trending, volume and new feeds. The panel holds only ONE of those at a
 * time — whichever tab is open — which is why this cannot simply read the
 * panel's state; it has to fetch all three. Graduated and Bonding are stage
 * filters over those same feeds, so their tokens are already in the union.
 *
 * FETCHED ON FIRST FOCUS, not on mount. Most sessions never open search, and
 * three feeds polling in the background for a box nobody clicks is waste.
 * /api/discover is cached server-side, so the fetch is shared across users.
 *
 * It searches, it does not decorate. Enter selects the top hit, arrows move,
 * escape closes — a search box that needs the mouse to finish is slower than
 * the list it was meant to replace.
 */

/** Every list the left panel can show, so nothing on screen is unsearchable. */
const FEEDS = ["organic", "traded", "new"] as const;

/*
 * Refetch when the list is older than this — on focus AND while typing.
 *
 * It was sixty seconds and refreshed only on focus, and the New feed churns
 * faster than that: "trench life" was in the feed and search could not find
 * it, because it arrived after the box first opened and the box stayed open.
 * /api/discover is cached server-side, so refetching is cheap.
 */
const STALE_MS = 15_000;

const MAX_HITS = 8;

interface Hit {
  /** The mint. What gets opened — the symbol is never the identity. */
  id: string;
  symbol: string;
  name: string;
  icon: string | null;
  hue?: string;
  glyph?: string;
  cap: number | null;
  /**
   * Jupiter's verification, shown as a tick.
   *
   * This is not decoration. Typing "btc" returned real Bitcoin AND "Buy The
   * Cat", an unverified memecoin that uses the same ticker — both rendered as
   * a bold "BTC", one click apart. The tick is what separates the coin you
   * meant from the one that borrowed its name.
   */
  verified: boolean;
}

/** The majors, always present even before the feeds have answered. */
const MAJORS: Hit[] = MARKETS.map((m) => ({
  id: m.symbol,
  symbol: m.base,
  name: m.name,
  icon: null,
  hue: m.hue,
  glyph: m.glyph,
  cap: null,
  /* Checked against Jupiter when these mints were chosen: all three are
     verified. See the MARKETS comment in lib/market/markets.ts. */
  verified: true,
}));

/**
 * Best match first.
 *
 * Plain "contains" put SOLCAT above SOL for the query "sol", because it came
 * first in the list. A trader typing a ticker means that ticker, so an exact
 * symbol wins outright, then a symbol that starts with the query, then a name
 * that does, then anything containing it. Ties keep the feeds' own order,
 * which is already sorted by what is actually trading.
 */
function rank(h: Hit, q: string): number {
  const sym = h.symbol.toLowerCase();
  const name = h.name.toLowerCase();
  if (sym === q) return 0;
  if (sym.startsWith(q)) return 1;
  if (name.startsWith(q)) return 2;
  if (sym.includes(q)) return 3;
  if (name.includes(q)) return 4;
  return -1;
}

export function MarketSearch({ onSelect }: { onSelect: (symbol: string) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [pool, setPool] = useState<Hit[]>(MAJORS);
  const fetchedAt = useRef(0);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  /*
   * Load every feed, merge by mint.
   *
   * Majors first, so SOL keeps its verified name and self-hosted mark rather
   * than whatever a feed calls it. allSettled rather than all: one feed timing
   * out should shorten the list, not empty it.
   */
  const load = useCallback(async () => {
    if (Date.now() - fetchedAt.current < STALE_MS) return;
    fetchedAt.current = Date.now();

    const results = await Promise.allSettled(
      FEEDS.map(async (feed) => {
        const res = await fetch(`/api/discover?feed=${feed}&limit=60`);
        if (!res.ok) return [] as TokenInfo[];
        const body = (await res.json()) as { tokens?: TokenInfo[] };
        return body.tokens ?? [];
      }),
    );

    const seen = new Set(MAJORS.map((m) => m.id));
    const merged: Hit[] = [...MAJORS];
    for (const r of results) {
      if (r.status !== "fulfilled") continue;
      for (const t of r.value) {
        if (!t.mint || seen.has(t.mint)) continue;
        seen.add(t.mint);
        merged.push({
          id: t.mint,
          symbol: t.symbol || "?",
          name: t.name || t.symbol || "",
          icon: t.icon ?? null,
          cap: displayCap(t),
          verified: Boolean(t.verified),
        });
      }
    }
    setPool(merged);
  }, []);

  const hits = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    return pool
      .map((h, i) => ({ h, r: rank(h, needle), i }))
      .filter((x) => x.r >= 0)
      .sort((a, b) => a.r - b.r || a.i - b.i)
      .slice(0, MAX_HITS)
      .map((x) => x.h);
  }, [q, pool]);

  /*
   * "/" focuses the box, which is the convention on every trading terminal —
   * and the reason the hint chip says so.
   *
   * Guarded on the event target: without it, typing a slash inside the prompt
   * bar at the bottom of the page yanks focus up here mid-sentence.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/") return;
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA)$/.test(el.tagName)) return;
      if (el?.isContentEditable) return;
      e.preventDefault();
      input.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Clicking anywhere else closes the results. Listening on the document is
  // the only way to catch a click that never reaches this subtree.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const choose = (id: string) => {
    onSelect(id);
    setQ("");
    setOpen(false);
    input.current?.blur();
  };

  return (
    <div ref={box} className="relative hidden w-full md:block">
      <div className="flex items-center gap-2 rounded-xl border border-line bg-slate px-3 py-1.5 focus-within:border-action">
        <span aria-hidden className="font-mono text-[12px] text-mute">
          ⌕
        </span>
        <input
          ref={input}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            setCursor(0);
            /* Throttled by STALE_MS, so this is at most one refetch in
               fifteen seconds however fast you type. */
            void load();
          }}
          onFocus={() => {
            setOpen(true);
            void load();
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") return setOpen(false);
            if (!hits.length) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setCursor((c) => (c + 1) % hits.length);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setCursor((c) => (c - 1 + hits.length) % hits.length);
            } else if (e.key === "Enter") {
              e.preventDefault();
              choose(hits[cursor].id);
            }
          }}
          /* Tokens only. Trader search was in the placeholder with no people
             behind it — cipher has no profiles to find. */
          placeholder="Search tokens…"
          aria-label="Search tokens"
          className="min-w-0 flex-1 bg-transparent font-sans text-[12.5px] text-champagne outline-none placeholder:text-mute"
        />
        <kbd className="rounded border border-line px-1.5 py-px font-mono text-[9.5px] text-mute">
          /
        </kbd>
      </div>

      {open && q.trim() && (
        <div className="absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-xl border border-line bg-panel shadow-2xl">
          {hits.length === 0 ? (
            /* Says why, rather than showing an empty box that looks broken. */
            <p className="px-3 py-2.5 font-sans text-[11.5px] text-mute">
              Nothing on cipher matches &ldquo;{q.trim()}&rdquo;.
            </p>
          ) : (
            hits.map((h, i) => (
              <button
                key={h.id}
                onClick={() => choose(h.id)}
                // Pointer, not focus: moving the mouse over a list should move
                // the highlight, or the keyboard cursor and the mouse disagree
                // about what Enter will do.
                onMouseEnter={() => setCursor(i)}
                className={`flex w-full items-center gap-2 px-2.5 py-2 text-left transition-colors ${
                  i === cursor ? "bg-raised" : ""
                }`}
              >
                <CoinMark symbol={h.symbol} icon={h.icon} hue={h.hue} glyph={h.glyph} size={24} />
                <span className="flex items-center gap-1 font-sans text-[12px] font-bold">
                  {h.symbol}
                  {h.verified && (
                    <span className="text-action" aria-label="Verified">
                      ✓
                    </span>
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate font-sans text-[11px] text-ash">{h.name}</span>
                {h.cap !== null && (
                  <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-mute">
                    {compactUsd(h.cap)} MC
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
