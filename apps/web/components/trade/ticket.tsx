"use client";

import { useState } from "react";
import { POSITION } from "@/lib/social/mock";
import { usd, pct } from "@/lib/format";

/**
 * The trade ticket.
 *
 * Parrot's shape, kept whole because it is the best part of that design: a
 * side toggle, one large amount, a conviction picker, and a squawk box. The
 * conviction row is the interesting idea — it asks "how sure are you?" and
 * multiplies the amount, which turns position sizing from a number you type
 * into a decision you make.
 *
 * Parrot's unlocked-liquidity warning is dropped here. This market is SOL on
 * Binance; there is no pool to pull and no deployer. Showing that warning
 * against a major would train people to click through it, which is exactly
 * how a real warning stops working.
 *
 * Execution is stubbed. Wiring it needs a funded wallet, a route from an
 * aggregator, and the relayer.
 */

type Side = "buy" | "sell";

const CONVICTION = [
  { k: 0.25, emoji: "🐣", label: "Nibble" },
  { k: 1, emoji: "🦜", label: "Normal" },
  { k: 4, emoji: "🚀", label: "Send it" },
] as const;

export function Ticket({ price }: { price: number | undefined }) {
  const [side, setSide] = useState<Side>("buy");
  const [amount, setAmount] = useState("250");
  const [conviction, setConviction] = useState(1);
  const [squawk, setSquawk] = useState("");
  const [sharing, setSharing] = useState(true);
  const [staged, setStaged] = useState<string | null>(null);

  const buying = side === "buy";
  const value = parseFloat(amount.replace(/,/g, "")) || 0;
  const estSol = price ? value / price : 0;

  /*
   * Conviction rescales the amount rather than replacing it. Someone who typed
   * 250 and taps "Send it" means 4x what they were going to do, not a fixed
   * house number — the multiplier has to compose with their own figure.
   */
  function pickConviction(k: number) {
    setAmount(String(Math.max(1, Math.round((value / conviction) * k))));
    setConviction(k);
  }

  return (
    <div className="flex flex-col gap-2.5 overflow-y-auto rounded-2xl border border-line bg-panel p-3">
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-ink p-1">
        {(["buy", "sell"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSide(s)}
            aria-pressed={side === s}
            className={`rounded-lg py-2.5 font-display text-sm font-bold capitalize transition-colors ${
              side === s
                ? s === "buy"
                  ? "bg-up text-ink"
                  : "bg-down text-ink"
                : "text-ash hover:text-champagne"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-line bg-slate px-3 py-2.5 focus-within:border-accent/50">
        <label
          htmlFor="tk-amount"
          className="font-sans text-[9.5px] font-bold uppercase tracking-[0.11em] text-ash"
        >
          {buying ? "Amount to spend" : "Amount to sell"}
        </label>
        <input
          id="tk-amount"
          inputMode="decimal"
          value={amount}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "" || /^\d*\.?\d*$/.test(v)) setAmount(v);
          }}
          className="w-full bg-transparent font-display text-[27px] font-bold tabular-nums text-champagne focus:outline-none"
        />
        <div className="flex justify-between font-sans text-[11px] text-ash">
          <span>USD</span>
          <span className="font-mono tabular-nums">
            {price ? `= ${estSol.toFixed(3)} SOL` : "—"}
          </span>
        </div>
      </div>

      <div>
        <div className="mb-1.5 font-sans text-[9.5px] font-bold uppercase tracking-[0.11em] text-ash">
          How sure are you?
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {CONVICTION.map((c) => (
            <button
              key={c.k}
              onClick={() => pickConviction(c.k)}
              aria-pressed={conviction === c.k}
              className={`flex flex-col items-center gap-0.5 rounded-xl border py-1.5 font-sans text-[11px] font-bold transition-colors ${
                conviction === c.k
                  ? "border-accent bg-accent/15 text-accent"
                  : "border-line bg-slate text-ash hover:text-champagne"
              }`}
            >
              <span className="text-[15px] leading-none">{c.emoji}</span>
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-line bg-slate px-3 py-2 focus-within:border-accent/50">
        <label
          htmlFor="tk-squawk"
          className="font-sans text-[9.5px] font-bold uppercase tracking-[0.11em] text-ash"
        >
          Your squawk
        </label>
        <textarea
          id="tk-squawk"
          value={squawk}
          onChange={(e) => setSquawk(e.target.value)}
          placeholder="Why are you doing this? Your flock reads it when the trade lands."
          className="min-h-[30px] w-full resize-none bg-transparent font-sans text-xs leading-snug text-champagne placeholder:text-ash focus:outline-none"
        />
        <div className="mt-1.5 flex items-center gap-2 border-t border-hairline pt-1.5 font-sans text-[11px] text-ash">
          <button
            onClick={() => setSharing((v) => !v)}
            aria-pressed={sharing}
            aria-label="Share this trade with your flock"
            className={`relative h-[18px] w-8 shrink-0 rounded-full transition-colors ${
              sharing ? "bg-accent" : "bg-raised"
            }`}
          >
            <span
              className={`absolute left-0 top-0.5 h-3.5 w-3.5 rounded-full transition-transform ${
                sharing ? "translate-x-[16px] bg-ink" : "translate-x-[2px] bg-ash"
              }`}
            />
          </button>
          {sharing ? (
            <span>
              Sharing with <b className="text-champagne">Chart Goblins</b> · 24 people
            </span>
          ) : (
            <span>Trading quietly. Nobody sees this one.</span>
          )}
        </div>
      </div>

      <dl className="flex flex-col gap-1.5 px-0.5 font-sans text-[11.5px]">
        {[
          ["Est. fill", price ? usd(price * (buying ? 1.0009 : 0.9991)) : "—"],
          ["Max slippage", "1.20%"],
          ["Fee", `$${(0.9 + value * 0.0025).toFixed(2)}`],
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between">
            <dt className="text-ash">{k}</dt>
            <dd className="font-mono tabular-nums text-champagne">{v}</dd>
          </div>
        ))}
      </dl>

      <button
        disabled={value <= 0}
        onClick={() =>
          setStaged(
            `Nothing was sent. On a live desk this fills near ${
              price ? usd(price) : "the last price"
            }${sharing ? ", and your squawk posts to Chart Goblins." : ", privately."}`,
          )
        }
        className={`rounded-xl py-3 font-display text-[15px] font-bold transition-transform active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-40 ${
          buying ? "bg-up text-ink" : "bg-down text-ink"
        }`}
      >
        {value > 0
          ? `${buying ? "Buy" : "Sell"} $${value.toLocaleString("en-US")} of SOL`
          : `Enter an amount to ${side}`}
      </button>

      {staged && (
        <p className="rounded-xl border border-accent/40 bg-accent/10 px-3 py-2 font-sans text-[11.5px] leading-relaxed text-champagne">
          {staged}
        </p>
      )}

      <Position price={price} />
    </div>
  );
}

function Position({ price }: { price: number | undefined }) {
  const { sizeSol, entryUsd } = POSITION;
  const pnl = price ? (price - entryUsd) * sizeSol : 0;
  const pnlPct = price ? ((price - entryUsd) / entryUsd) * 100 : 0;

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-slate">
      <h3 className="px-3 py-2 font-sans text-[10px] font-bold uppercase tracking-[0.11em] text-ash">
        Your position
      </h3>
      <dl className="flex flex-col gap-1.5 px-3 pb-3 font-sans text-[11.5px]">
        {[
          ["Size", `${sizeSol} SOL`],
          ["Your entry", usd(entryUsd)],
          ["Now", price ? usd(price) : "—"],
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between">
            <dt className="text-ash">{k}</dt>
            <dd className="font-mono tabular-nums text-champagne">{v}</dd>
          </div>
        ))}
        <div className="flex justify-between">
          <dt className="text-ash">P&amp;L</dt>
          <dd
            className={`font-mono font-bold tabular-nums ${pnl >= 0 ? "text-up" : "text-down"}`}
          >
            {pnl >= 0 ? "+" : "−"}${Math.abs(pnl).toFixed(2)} ({pct(pnlPct, false)})
          </dd>
        </div>
      </dl>
    </div>
  );
}
