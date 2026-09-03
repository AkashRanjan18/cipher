"use client";

import { useState } from "react";

/**
 * The conventional trade panel — buy and sell at market.
 *
 * This is the surface every competitor has, and it is deliberately boring:
 * a side toggle, an amount, four presets, one button. fomo's panel is the
 * same shape because the shape is solved.
 *
 * The one thing that is not negotiable is scale. This is the primary action
 * on the screen, so the amount field is the largest type on the page and the
 * button is full width. A trading panel built at the density of the data
 * around it reads as another readout rather than the thing you came to do.
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
  const buying = side === "buy";

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-line bg-panel p-4">
      {/*
        Side toggle. The active side carries its market colour; the inactive
        one stays neutral. A permanently red Sell reads as a warning rather
        than a choice, and two lit buttons read as neither being selected.
      */}
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-ink p-1">
        {(["buy", "sell"] as const).map((s) => (
          <button
            key={s}
            onClick={() => {
              setSide(s);
              setAmount("");
            }}
            aria-pressed={side === s}
            className={`rounded-lg py-2.5 font-sans text-sm font-semibold capitalize transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-champagne ${
              side === s
                ? s === "buy"
                  ? "bg-up/15 text-up"
                  : "bg-down/15 text-down"
                : "text-ash hover:text-champagne"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {/* The amount field is the headline of this panel, so it is sized like
          one — 30px, against 12px labels everywhere else. */}
      <div className="flex items-center gap-2 rounded-xl border border-line bg-ink px-4 py-3">
        <span className="font-mono text-3xl text-ash">
          {buying ? "$" : ""}
        </span>
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
          aria-label={buying ? "Amount in dollars" : "Percent of position"}
          className="w-full min-w-0 bg-transparent font-mono text-3xl tabular-nums text-champagne placeholder:text-ash/40 focus:outline-none"
        />
        <span className="shrink-0 font-sans text-xs text-ash">
          {buying ? "" : "%"}
        </span>
      </div>

      <div className="grid grid-cols-4 gap-2">
        {presets.map((p) => (
          <button
            key={p}
            onClick={() => setAmount(String(p))}
            className="rounded-lg border border-line py-2 font-mono text-xs text-ash transition-colors hover:border-champagne/40 hover:text-champagne focus-visible:outline focus-visible:outline-2 focus-visible:outline-champagne"
          >
            {buying ? `$${p}` : `${p}%`}
          </button>
        ))}
      </div>

      <div className="flex items-baseline justify-between font-sans text-xs">
        <span className="text-ash">available</span>
        {/* Not "$0.00" — see top-bar. Claiming a zero balance we never
            looked up is worse than admitting we have not looked. */}
        <span className="font-mono text-champagne">—</span>
      </div>

      <button
        disabled
        title="Execution is not wired up yet"
        className={`rounded-xl py-3.5 font-sans text-sm font-semibold transition-colors disabled:cursor-not-allowed ${
          buying
            ? "bg-up/20 text-up disabled:bg-up/10 disabled:text-up/50"
            : "bg-down/20 text-down disabled:bg-down/10 disabled:text-down/50"
        }`}
      >
        {buying ? `Buy ${token}` : `Sell ${token}`}
      </button>

      <p className="text-center font-sans text-[11px] text-ash">
        Execution needs a wallet — not connected yet
      </p>
    </div>
  );
}
