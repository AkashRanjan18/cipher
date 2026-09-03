"use client";

import { useState } from "react";
import { parseWithGrammar } from "@/lib/compiler/grammar";
import { readback, type ReadbackLine } from "@/lib/compiler/readback";
import type { OrderSpec } from "@cipher/shared";

/**
 * The prompt panel — where fomo puts Buy / Sell / amount / $10 $100 $500.
 *
 * That swap is the entire product. Everything else on a trading screen is
 * table stakes; this is the part nobody else has.
 *
 * Compiles in the browser for now: the grammar is pure and synchronous, so a
 * sentence it understands needs no round trip at all. Sentences it returns
 * null on will go to the model through /api/compile, which is the next piece.
 */

const EXAMPLES = [
  "buy me $500 of bonk, sell a third at 2x and stop the rest at -50%",
  "buy $200 of wif, max 1% slippage",
  "sell half at 3x, trail 30% on the rest",
];

export function PromptPanel() {
  const [input, setInput] = useState("");
  const [spec, setSpec] = useState<OrderSpec | null>(null);
  const [lines, setLines] = useState<ReadbackLine[] | null>(null);
  const [unparsed, setUnparsed] = useState(false);

  function compile(text: string) {
    const parsed = parseWithGrammar(text);
    if (!parsed) {
      // The grammar refuses rather than half-parsing. Nothing is shown,
      // because a partial readback would look plausible and get approved.
      setSpec(null);
      setLines(null);
      setUnparsed(text.trim().length > 0);
      return;
    }
    setSpec(parsed);
    setLines(readback(parsed));
    setUnparsed(false);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    compile(input);
  }

  return (
    <div className="flex flex-col gap-5 rounded-2xl border border-champagne/10 bg-slate p-5">
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <label htmlFor="prompt" className="font-sans text-sm text-champagne/80">
          What do you want to do?
        </label>

        <textarea
          id="prompt"
          rows={3}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            // Enter compiles, shift+enter breaks the line. A trading input
            // that needs a mouse to submit is the wrong shape.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSubmit(e);
            }
          }}
          placeholder="buy me $500 of bonk, sell a third at 2x and stop the rest at -50%"
          className="w-full resize-none rounded-xl border border-champagne/15 bg-ink px-4 py-3 font-sans text-sm leading-relaxed text-champagne placeholder:text-ash/60 focus:border-champagne/40 focus:outline-none"
        />

        <button
          type="submit"
          disabled={!input.trim()}
          className="rounded-xl bg-champagne px-4 py-2.5 font-sans text-sm font-medium text-ink transition-opacity hover:opacity-90 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-champagne"
        >
          Read it back
        </button>
      </form>

      {!lines && !unparsed && (
        <div className="flex flex-col gap-2">
          <p className="font-mono text-[10px] tracking-[0.2em] text-ash">TRY</p>
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              onClick={() => {
                setInput(ex);
                compile(ex);
              }}
              className="rounded-lg border border-champagne/10 px-3 py-2 text-left font-sans text-xs leading-relaxed text-ash transition-colors hover:border-champagne/30 hover:text-champagne"
            >
              {ex}
            </button>
          ))}
        </div>
      )}

      {unparsed && (
        <p className="font-sans text-sm text-ash">
          Couldn&rsquo;t read that one yet. The model fallback isn&rsquo;t
          wired up — try one of the shapes above.
        </p>
      )}

      {lines && spec && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-champagne/12" />
            <span className="font-mono text-[10px] tracking-[0.25em] text-ash">
              THIS IS WHAT WILL HAPPEN
            </span>
            <div className="h-px flex-1 bg-champagne/12" />
          </div>

          {/*
            The contract. The user approves THIS, not what they typed — so it
            renders the compiled spec and never echoes the sentence back.
          */}
          <dl className="flex flex-col gap-3 font-mono text-sm">
            {lines.map((l, i) => (
              <div key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <dt className="w-20 shrink-0 text-[11px] tracking-[0.12em] text-ash">
                  {l.label}
                </dt>
                <dd className="text-champagne tabular-nums">{l.value}</dd>
                {l.note && (
                  <dd className="w-full pl-[5.75rem] font-sans text-xs text-ash">
                    {l.note}
                  </dd>
                )}
              </div>
            ))}
          </dl>

          <button
            disabled
            title="Execution is not wired up yet"
            className="rounded-xl border border-champagne/20 px-4 py-2.5 font-sans text-sm text-ash disabled:cursor-not-allowed"
          >
            Arm this order — not connected yet
          </button>
        </div>
      )}
    </div>
  );
}
