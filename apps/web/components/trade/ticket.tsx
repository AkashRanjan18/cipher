"use client";

import { useState } from "react";
import { usePaperAccount } from "@/lib/account/store";
import { quote, fillPrice, maxBuyUsd, unrealised, equity } from "@/lib/account/paper";
import { usd, pct } from "@/lib/format";

/**
 * The trade ticket.
 *
 * Parrot's shape, wired to the paper account. Pressing the button moves money:
 * the balance drops, the position appears, and the P&L on it is marked against
 * the live Binance price from that moment on.
 *
 * Every number on this card comes from quote(), including the reason the
 * button is disabled. Computing the preview one way and the execution another
 * is how a screen promises one price and charges a different one.
 *
 * Parrot's unlocked-liquidity warning is dropped. This market is SOL on
 * Binance; there is no pool to pull and no deployer. Showing that warning
 * against a major would train people to click through it, which is exactly
 * how a real warning stops working.
 */

type Side = "buy" | "sell";

const CONVICTION = [
  { k: 0.25, emoji: "🐣", label: "Nibble" },
  { k: 1, emoji: "🦜", label: "Normal" },
  { k: 4, emoji: "🚀", label: "Send it" },
] as const;

export function Ticket({ price }: { price: number | undefined }) {
  const { account, hydrated, trade } = usePaperAccount();
  const [side, setSide] = useState<Side>("buy");
  const [amount, setAmount] = useState("250");
  const [conviction, setConviction] = useState(1);
  const [squawk, setSquawk] = useState("");
  const [sharing, setSharing] = useState(true);
  const [receipt, setReceipt] = useState<{ ok: boolean; text: string } | null>(null);
  /*
   * Set only by Max on a sell. "Sell everything" is a quantity instruction,
   * and routing it through the USD box rounds it to the cent and converts it
   * back, which leaves a few millionths of a SOL behind. Carrying the intent
   * explicitly sells the exact position.
   */
  const [sellAll, setSellAll] = useState(false);

  const buying = side === "buy";
  const value = parseFloat(amount.replace(/,/g, "")) || 0;

  /*
   * The USD box is turned into a quantity through the FILL price, not the
   * mark — $250 buys slightly less than $250/chart-price, and the ticket
   * should say so before the trade rather than after it.
   */
  const qty = !price ? 0 : sellAll && !buying ? account.sol : value / fillPrice(price, side);
  const q = price ? quote(account, side, qty, price) : null;

  /* Only block on a refusal once the real balance is known. Before hydration
     the account is the opening default, and refusing against it would be a
     refusal about the wrong account. */
  const blocked = hydrated ? (q?.refusal ?? null) : null;

  /*
   * Conviction rescales the amount rather than replacing it. Someone who typed
   * 250 and taps "Send it" means 4x what they were going to do, not a fixed
   * house number — the multiplier has to compose with their own figure.
   */
  function pickConviction(k: number) {
    setAmount(String(Math.max(1, Math.round((value / conviction) * k))));
    setConviction(k);
    setSellAll(false);
  }

  /** Max is the whole balance on a buy, the whole position on a sell. */
  function goMax() {
    if (!price) return;
    const max = buying ? maxBuyUsd(account) : account.sol * fillPrice(price, "sell");
    setAmount(max.toFixed(2));
    setConviction(1);
    setSellAll(!buying);
  }

  function submit() {
    if (!price) return;
    const r = trade({ side, qty, mark: price, squawk, source: "ticket" });
    if ("refusal" in r) {
      setReceipt({ ok: false, text: r.refusal });
      return;
    }
    /*
     * The receipt names the RESULTING CASH BALANCE, not just the fill.
     *
     * "Bought 2.4177 SOL at $103.40" does not answer the only question the
     * user actually has after pressing the button, which is whether the money
     * came out. Saying the new balance answers it in the same glance, and
     * stops the button being pressed again to check.
     */
    const q2 = quote(account, side, qty, price);
    const cashAfter = buying ? account.usdc - q2.cashUsd : account.usdc + q2.cashUsd;
    setSellAll(false);
    setReceipt({
      ok: true,
      text:
        `${buying ? "Bought" : "Sold"} ${r.fill.qty.toFixed(4)} SOL at ${usd(r.fill.price)}, ` +
        `fee ${usd(r.fill.feeUsd)}. Cash is now ${usd(cashAfter)}.` +
        (buying
          ? ""
          : ` Booked ${r.fill.realisedUsd >= 0 ? "+" : "−"}${usd(Math.abs(r.fill.realisedUsd))}.`) +
        (sharing && squawk.trim() ? " Your squawk went with it." : ""),
    });
    setSquawk("");
  }

  return (
    /*
     * [&>*]:shrink-0 on the children, not decoration.
     *
     * This column scrolls, so flexbox is free to compress its children to
     * make them fit — and a child carrying overflow-hidden has no content
     * floor to push back with. The position card collapsed to 2.65px tall:
     * present in the DOM, correct in every number, and invisible. Anything
     * added to this column needs to keep its natural height and let the
     * container scroll instead.
     */
    <div className="flex flex-col gap-2.5 overflow-y-auto rounded-2xl border border-line bg-panel p-3 [&>*]:shrink-0">
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-ink p-1">
        {(["buy", "sell"] as const).map((s) => (
          <button
            key={s}
            onClick={() => {
              setSide(s);
              setSellAll(false);
              setReceipt(null);
            }}
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

      {/* What you hold, directly under the side toggle. It sat at the bottom
          of the card and was below the fold, so the one number that tells you
          whether to press Buy or Sell was the one you had to scroll for. */}
      <Position price={price} />

      <div className="rounded-xl border border-line bg-slate px-3 py-2.5 focus-within:border-accent/50">
        <div className="flex items-baseline justify-between">
          <label
            htmlFor="tk-amount"
            className="font-sans text-[9.5px] font-bold uppercase tracking-[0.11em] text-ash"
          >
            {buying ? "Amount to spend" : "Amount to sell"}
          </label>
          <button
            onClick={goMax}
            className="font-sans text-[10px] font-bold uppercase tracking-[0.08em] text-accent hover:brightness-125"
          >
            Max
          </button>
        </div>
        <input
          id="tk-amount"
          inputMode="decimal"
          value={amount}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "" || /^\d*\.?\d*$/.test(v)) {
              setAmount(v);
              setSellAll(false);
            }
          }}
          className="w-full bg-transparent font-display text-[27px] font-bold tabular-nums text-champagne focus:outline-none"
        />
        <div className="flex justify-between font-sans text-[11px] text-ash">
          <span>USD</span>
          <span className="font-mono tabular-nums">
            {price ? `≈ ${qty.toFixed(4)} SOL` : "—"}
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
          placeholder="Why are you doing this? It gets saved with the fill."
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

      {/* Costs, straight off the quote — not a second formula that agrees by luck. */}
      <dl className="flex flex-col gap-1.5 px-0.5 font-sans text-[11.5px]">
        {[
          ["Your fill", q ? usd(q.price) : "—"],
          ["Fee", q ? usd(q.feeUsd) : "—"],
          [buying ? "Total cost" : "You receive", q ? usd(q.cashUsd) : "—"],
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between">
            <dt className="text-ash">{k}</dt>
            <dd className="font-mono tabular-nums text-champagne">{v}</dd>
          </div>
        ))}
      </dl>

      <button
        disabled={!price || !!blocked || value <= 0}
        onClick={submit}
        className={`rounded-xl py-3 font-display text-[15px] font-bold transition-transform active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-40 ${
          buying ? "bg-up text-ink" : "bg-down text-ink"
        }`}
      >
        {value > 0
          ? `${buying ? "Buy" : "Sell"} $${value.toLocaleString("en-US")} of SOL`
          : `Enter an amount to ${side}`}
      </button>

      {/* The refusal is shown even while the button is disabled, because a
          dead button with no reason beside it is the worst state a ticket has. */}
      {blocked && value > 0 && (
        <p className="rounded-xl border border-down/40 bg-down/10 px-3 py-2 font-sans text-[11.5px] leading-relaxed text-champagne">
          {blocked}
        </p>
      )}

      {receipt && (
        <p
          className={`rounded-xl border px-3 py-2 font-sans text-[11.5px] leading-relaxed text-champagne ${
            receipt.ok ? "border-accent/40 bg-accent/10" : "border-down/40 bg-down/10"
          }`}
        >
          {receipt.text}
        </p>
      )}

    </div>
  );
}

/**
 * The position card, read from the account rather than a fixture.
 *
 * Break-even is shown next to the entry because the entry alone is misleading
 * — the cost basis already carries the buy fee, and the sell fee is still to
 * come, so the price that gets you out flat is above the price you paid.
 */
function Position({ price }: { price: number | undefined }) {
  const { account, hydrated } = usePaperAccount();
  const { sol, costBasis, usdc, realisedUsd, feesUsd } = account;

  const open = sol > 0;
  const pnl = price && open ? unrealised(account, price) : 0;
  const pnlPct = open && costBasis > 0 && price ? ((price - costBasis) / costBasis) * 100 : 0;
  const value = hydrated && price ? equity(account, price) : null;

  const rows: [string, string][] = open
    ? [
        ["Size", `${sol.toFixed(4)} SOL`],
        ["Cost basis", usd(costBasis)],
        ["Now", price ? usd(price) : "—"],
      ]
    : [
        ["Cash", hydrated ? usd(usdc) : "—"],
        ["Position", "flat"],
      ];

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-slate">
      <div className="flex items-baseline justify-between px-3 py-2">
        <h3 className="font-sans text-[10px] font-bold uppercase tracking-[0.11em] text-ash">
          Your account
        </h3>
        <span className="font-mono text-[12px] font-bold tabular-nums text-champagne">
          {value === null ? "—" : usd(value)}
        </span>
      </div>
      <dl className="flex flex-col gap-1.5 px-3 pb-3 font-sans text-[11.5px]">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between">
            <dt className="text-ash">{k}</dt>
            <dd className="font-mono tabular-nums text-champagne">{v}</dd>
          </div>
        ))}

        {open && (
          <div className="flex justify-between">
            <dt className="text-ash">Open P&amp;L</dt>
            <dd
              className={`font-mono font-bold tabular-nums ${pnl >= 0 ? "text-up" : "text-down"}`}
            >
              {pnl >= 0 ? "+" : "−"}
              {usd(Math.abs(pnl))} ({pct(pnlPct, false)})
            </dd>
          </div>
        )}

        {hydrated && (realisedUsd !== 0 || feesUsd > 0) && (
          <div className="flex justify-between border-t border-hairline pt-1.5">
            <dt className="text-ash">Booked · fees paid</dt>
            <dd className="font-mono tabular-nums">
              <span className={realisedUsd >= 0 ? "text-up" : "text-down"}>
                {realisedUsd >= 0 ? "+" : "−"}
                {usd(Math.abs(realisedUsd))}
              </span>
              <span className="text-ash"> · {usd(feesUsd)}</span>
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}
