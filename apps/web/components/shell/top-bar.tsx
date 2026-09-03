"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { PoolSummary } from "@/lib/market";
import { compactUsd } from "@/lib/format";

/**
 * The global bar: brand, one search box, and the account corner.
 *
 * The search lives up here rather than inside a panel because it is how you
 * change what the whole screen is about. Every terminal binds it to a key —
 * "/" focuses it — so a trader never reaches for the mouse to switch token.
 */

export function TopBar() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PoolSummary[] | null>(null);
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();

  /* "/" focuses search, Escape closes it — the two bindings every terminal has. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      const typing =
        el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;

      if (e.key === "/" && !typing) {
        e.preventDefault();
        input.current?.focus();
      }
      if (e.key === "Escape") {
        setOpen(false);
        input.current?.blur();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults(null);
      return;
    }

    // Debounce and abort — a fast typist otherwise settles on whichever
    // response happens to land last, usually the least specific one.
    const ctrl = new AbortController();
    const id = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
          signal: ctrl.signal,
        });
        if (!res.ok) return;
        const { results } = (await res.json()) as { results: PoolSummary[] };
        setResults(results);
        setOpen(true);
      } catch {
        // Aborted or offline; leave the previous list alone.
      }
    }, 250);

    return () => {
      clearTimeout(id);
      ctrl.abort();
    };
  }, [query]);

  const go = (mint: string) => {
    setOpen(false);
    setQuery("");
    router.push(`/trade/${mint}`);
  };

  return (
    <header className="flex shrink-0 items-center gap-4 border-b border-line bg-ink px-4 py-2.5">
      <Link
        href="/trade"
        className="font-display text-xl lowercase text-champagne"
      >
        cipher
      </Link>

      <div className="relative mx-auto w-full max-w-xl">
        <input
          ref={input}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results && setOpen(true)}
          /* A click inside the dropdown must land before blur closes it. */
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Search a token, or paste a contract address"
          aria-label="Search tokens"
          className="w-full rounded-lg border border-line bg-panel px-3 py-2 pr-10 font-sans text-sm text-champagne placeholder:text-ash/60 focus:border-champagne/30 focus:outline-none"
        />
        <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-champagne/15 px-1.5 py-0.5 font-mono text-[11px] text-ash">
          /
        </kbd>

        {open && results && (
          <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-80 overflow-y-auto rounded-lg border border-champagne/15 bg-panel shadow-xl">
            {results.length === 0 ? (
              <p className="p-3 font-mono text-[11px] text-ash">no matches</p>
            ) : (
              results.map((r) => (
                <button
                  key={r.pairAddress}
                  onClick={() => go(r.mint)}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-champagne/5"
                >
                  <span className="truncate font-mono text-xs text-champagne">
                    {r.symbol}
                  </span>
                  <span className="shrink-0 font-mono text-[11px] text-ash">
                    liq {compactUsd(r.liquidityUsd)}
                  </span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/*
        Cash and portfolio value. Both need a funded wallet, so they read as
        explicit placeholders rather than a confident $0.00 — telling someone
        their balance is zero when we have not looked is worse than saying so.
      */}
      <div className="flex items-center gap-4 font-mono text-xs">
        <div className="flex flex-col items-end leading-tight">
          <span className="text-ash">cash</span>
          <span className="text-champagne">—</span>
        </div>
        <div className="flex flex-col items-end leading-tight">
          <span className="text-ash">positions</span>
          <span className="text-champagne">—</span>
        </div>
      </div>
    </header>
  );
}
