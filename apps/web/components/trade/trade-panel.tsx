"use client";

import { useState } from "react";

/**
 * The conventional trade panel — buy and sell at market.
 *
 * This is the surface every competitor has, and it is deliberately boring:
 * a side toggle, an amount, four presets, one button. fomo's panel is the
 * same shape because the shape is solved.
 *
 * What is NOT here, and why:
 *
 *   short   there is nothing to borrow on spot. Shorting is a perps
 *           instrument and arrives with Hyperliquid.
 *   limit   "buy when it hits X" is a rule watching a price — the same
 *           machinery as a stop, so it ships with the trigger engine
 *           rather than before it.
 *
 * Execution is stubbed. Wiring it needs an RPC endpoint, a route from an
 * aggregator, and a funded wallet.
 */

type Side = "buy" | "sell";

/** Presets in the units the user thinks in: dollars to buy, share to sell. */
const BUY_PRESETS = [10, 100, 500, 1000];
const SELL_PRESETS = [25, 50, 75, 100];

export function TradePanel({ token = "BONK" }: { token?: string }) {
  const [side, setSide] = useState<Side>("buy");
  const [amount, setAmount] = useState("");

  const presets = side === "buy" ? BUY_PRESETS : SELL_PRESETS;
  const unit = side === "buy" ? "$" : "%";

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-champagne/10 bg-slate p-5">
      {/* Side toggle. Sell is red-tinted only when active — a permanently
          red control reads as a warning rather than a choice. */}
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-ink p-1">
        {(["buy", "sell"] as const).map((s) => (
          <button
            key={s}
            onClick={() => {
              setSide(s);
              setAmount("");
            }}
            aria-pressed={side === s}
            className={`rounded-lg px-4 py-2.5 font-sans text-sm font-medium capitalize transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-champagne ${
              side === s
                ? s === "buy"
                  ? "bg-champagne text-ink"
                  : "bg-red-400/90 text-ink"
                : "text-ash hover:text-champagne"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="flex items-baseline gap-2 rounded-xl border border-champagne/15 bg-ink px-4 py-3">
        <span className="font-mono text-lg text-ash">{unit}</span>
        <input
          type="text"
          inputMode="decimal"
          value={amount}
          /* Digits and one decimal point only. A trading input that accepts
             letters produces NaN somewhere downstream. */
          onChange={(e) => {
            const v = e.target.value;
            if (v === "" || /^\d*\.?\d*$/.test(v)) setAmount(v);
          }}
          placeholder="0"
          aria-label={side === "buy" ? "Amount in dollars" : "Percent of position"}
          className="w-full bg-transparent font-mono text-lg tabular-nums text-champagne placeholder:text-ash/50 focus:outline-none"
        />
      </div>

      <div className="grid grid-cols-4 gap-2">
        {presets.map((p) => (
          <button
            key={p}
            onClick={() => setAmount(String(p))}
            className="rounded-lg border border-champagne/12 py-2 font-mono text-xs text-ash transition-colors hover:border-champagne/40 hover:text-champagne focus-visible:outline focus-visible:outline-2 focus-visible:outline-champagne"
          >
            {side === "buy" ? `$${p}` : `${p}%`}
          </button>
        ))}
      </div>

      <div className="flex items-baseline justify-between font-mono text-xs text-ash">
        <span>available</span>
        <span className="tabular-nums">$0.00</span>
      </div>

      <button
        disabled
        title="Execution is not wired up yet"
        className="rounded-xl border border-champagne/20 py-3 font-sans text-sm text-ash disabled:cursor-not-allowed"
      >
        {side === "buy" ? `Buy ${token}` : `Sell ${token}`} — not connected yet
      </button>
    </div>
  );
}
