"use client";

import { useEffect, useRef, useState } from "react";
import { CoinMark } from "./coin-mark";
import { MARKETS } from "@/lib/market";

/**
 * The search bar across the top, as fomo has it.
 *
 * It is the widest element in their header and that is a deliberate claim:
 * search is how you get anywhere on a platform with thousands of markets, so
 * it gets more space than the logo and the balance combined.
 *
 * It searches, it does not decorate. Enter selects the top hit, arrows move,
 * escape closes — because a search box that needs the mouse to finish is
 * slower than the list it was meant to replace.
 */
export function MarketSearch({ onSelect }: { onSelect: (symbol: string) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const hits = q.trim()
    ? MARKETS.filter((m) =>
        `${m.base} ${m.name}`.toLowerCase().includes(q.trim().toLowerCase()),
      ).slice(0, 8)
    : [];

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

  const choose = (symbol: string) => {
    onSelect(symbol);
    setQ("");
    setOpen(false);
    input.current?.blur();
  };

  return (
    <div ref={box} className="relative mx-auto hidden w-full max-w-md md:block">
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
          }}
          onFocus={() => setOpen(true)}
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
              choose(hits[cursor].symbol);
            }
          }}
          placeholder="Search for tokens or traders…"
          aria-label="Search markets"
          className="min-w-0 flex-1 bg-transparent font-sans text-[12.5px] text-champagne outline-none placeholder:text-mute"
        />
        <kbd className="rounded border border-line px-1.5 py-px font-mono text-[9.5px] text-mute">
          /
        </kbd>
      </div>

      {open && hits.length > 0 && (
        <div className="absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-xl border border-line bg-panel shadow-2xl">
          {hits.map((m, i) => (
            <button
              key={m.symbol}
              onClick={() => choose(m.symbol)}
              // Pointer, not focus: moving the mouse over a list should move
              // the highlight, or the keyboard cursor and the mouse disagree
              // about what Enter will do.
              onMouseEnter={() => setCursor(i)}
              className={`flex w-full items-center gap-2 px-2.5 py-2 text-left transition-colors ${
                i === cursor ? "bg-raised" : ""
              }`}
            >
              <CoinMark symbol={m.base} hue={m.hue} glyph={m.glyph} size={24} />
              <span className="font-sans text-[12px] font-bold">{m.base}</span>
              <span className="truncate font-sans text-[11px] text-ash">{m.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
