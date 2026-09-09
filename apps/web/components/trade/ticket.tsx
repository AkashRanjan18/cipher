"use client";

import { useState } from "react";
import { usePaperAccount } from "@/lib/account/store";
import {
  quote,
  fillPrice,
  maxBuyUsd,
  unrealised,
  equity,
  allInPrice,
} from "@/lib/account/paper";
import { usd, pct } from "@/lib/format";

/**
 * The trade ticket. Buy, sell, position. Nothing else.
 *
 * Stripped to the shape every serious terminal converges on — side, amount,
 * presets, one button — because everything else that was here was asking the
 * user a question they had not asked to be asked. Gone: the conviction
 * picker (a multiplier on a number you already typed), the squawk box and the
 * share toggle (social, and it belongs with the feed rather than in the path
 * between a decision and a fill).
 *
 * NO FEE IS ITEMISED ANYWHERE, by instruction. The commission is still
 * charged — the ledger would not balance otherwise — so every price on this
 * screen is quoted ALL-IN instead: the figure shown already contains it, and
 * quantity times price equals the cash that actually moves. That is the only
 * way to drop the line item without leaving a balance the user cannot
 * reconcile against the numbers in front of them.
 *
 * Presets switch units with the side. Dollars are the wrong question on a
 * sell — nobody thinks "$500 of my position", they think "half".
 */

type Side = "buy" | "sell";

const BUY_PRESETS = [10, 100, 500, 1000];
const SELL_PRESETS = [25, 50, 75, 100];

export function Ticket({ price }: { price: number | undefined }) {
  const { account, hydrated, trade } = usePaperAccount();
  const [side, setSide] = useState<Side>("buy");
  const [amount, setAmount] = useState("");
  const [receipt, setReceipt] = useState<{ ok: boolean; text: string } | null>(null);
  /*
   * Set only by the 100% preset. "Sell everything" is a quantity instruction,
   * and routing it through the USD box rounds it to the cent and converts it
   * back, leaving a few millionths of a SOL behind.
   */
  const [sellAll, setSellAll] = useState(false);

  const buying = side === "buy";
  const value = parseFloat(amount.replace(/,/g, "")) || 0;

  const qty = !price ? 0 : sellAll && !buying ? account.sol : value / fillPrice(price, side);
  const q = price ? quote(account, side, qty, price) : null;

  /* Only block on a refusal once the real balance is known. Before hydration
     the account is the opening default, and refusing against it would be a
     refusal about the wrong account. */
  const blocked = hydrated ? (q?.refusal ?? null) : null;

  /** What you can spend on a buy, what the position is worth on a sell. */
  const available =
    !hydrated || !price
      ? null
      : buying
        ? maxBuyUsd(account)
        : account.sol * fillPrice(price, "sell");

  function edit(v: string) {
    if (v === "" || /^\d*\.?\d*$/.test(v)) {
      setAmount(v);
      setSellAll(false);
    }
  }

  function preset(n: number) {
    if (buying) {
      setAmount(String(n));
      setSellAll(false);
      return;
    }
    if (!price) return;
    // A percentage of the position, priced back into the box.
    setAmount(((account.sol * fillPrice(price, "sell") * n) / 100).toFixed(2));
    setSellAll(n === 100);
  }

  /** The available line is a button: tapping it spends or sells all of it. */
  function useAvailable() {
    if (available === null || available <= 0) return;
    if (buying) {
      setAmount(available.toFixed(2));
      setSellAll(false);
    } else {
      preset(100);
    }
  }

  function submit() {
    if (!price) return;
    const before = account.usdc;
    const cash = q?.cashUsd ?? 0;
    const r = trade({ side, qty, mark: price, source: "ticket" });
    if ("refusal" in r) {
      setReceipt({ ok: false, text: r.refusal });
      return;
    }
    /*
     * The receipt names the RESULTING CASH BALANCE, which is the only thing
     * the user actually wants confirmed after pressing a button that moves
     * money — and the all-in price, so quantity × price is exactly the cash
     * that moved and nothing looks unaccounted for.
     */
    setSellAll(false);
    setAmount("");
    setReceipt({
      ok: true,
      text:
        `${buying ? "Bought" : "Sold"} ${r.fill.qty.toFixed(4)} SOL at ` +
        `${usd(allInPrice(r.fill))}. Cash is now ${usd(buying ? before - cash : before + cash)}.` +
        (buying
          ? ""
          : ` Booked ${r.fill.realisedUsd >= 0 ? "+" : "−"}${usd(Math.abs(r.fill.realisedUsd))}.`),
    });
  }

  return (
    /*
     * [&>*]:shrink-0 on the children, not decoration.
     *
     * This column scrolls, so flexbox is free to compress its children to fit
     * — and a child carrying overflow-hidden has no content floor to push
     * back with. The position card collapsed to 2.65px tall: present in the
     * DOM, correct in every number, and invisible.
     */
    <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto rounded-2xl border border-line bg-panel p-3 [&>*]:shrink-0">
      <div className="grid grid-cols-2 gap-2">
        {(["buy", "sell"] as const).map((s) => (
          <button
            key={s}
            onClick={() => {
              setSide(s);
              setAmount("");
              setSellAll(false);
              setReceipt(null);
            }}
            aria-pressed={side === s}
            className={`rounded-xl border py-2.5 font-display text-[15px] font-bold capitalize transition-colors ${
              side === s
                ? s === "buy"
                  ? "border-up/50 bg-up/15 text-up"
                  : "border-down/50 bg-down/15 text-down"
                : "border-line bg-slate text-ash hover:text-champagne"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-line bg-slate px-3.5 py-3 focus-within:border-accent/50">
        <div className="flex items-baseline gap-1.5">
          <span
            className={`font-display text-[30px] font-bold leading-none ${
              value > 0 ? "text-champagne" : "text-ash"
            }`}
          >
            $
          </span>
          <input
            id="tk-amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => edit(e.target.value)}
            placeholder="0"
            aria-label={buying ? "Amount to spend in dollars" : "Amount to sell in dollars"}
            className="min-w-0 flex-1 bg-transparent font-display text-[30px] font-bold leading-none tabular-nums text-champagne placeholder:text-ash focus:outline-none"
          />
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-ash">
            {price && qty > 0 ? `${qty.toFixed(4)} SOL` : "Enter amount"}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        {(buying ? BUY_PRESETS : SELL_PRESETS).map((n) => (
          <button
            key={n}
            onClick={() => preset(n)}
            className="flex-1 rounded-lg border border-line bg-slate py-1.5 font-sans text-[11.5px] font-bold text-champagne transition-colors hover:border-ash"
          >
            {buying ? `$${n}` : `${n}%`}
          </button>
        ))}
      </div>

      {/* What you can actually use, and a one-tap way to use all of it. */}
      <button
        onClick={useAvailable}
        disabled={available === null || available <= 0}
        className="-mt-0.5 self-start font-sans text-[11.5px] text-accent transition-[filter] hover:brightness-125 disabled:text-ash"
      >
        {available === null ? "—" : `${usd(available)} available`}
      </button>

      <button
        disabled={!price || !!blocked || value <= 0}
        onClick={submit}
        className={`rounded-xl py-3 font-display text-[15px] font-bold transition-transform active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-40 ${
          buying ? "bg-up text-ink" : "bg-down text-ink"
        }`}
      >
        {buying ? "Buy" : "Sell"} SOL
      </button>

      {/* The refusal shows even while the button is disabled — a dead button
          with no reason beside it is the worst state a ticket has. */}
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

      <Position price={price} />
    </div>
  );
}

/**
 * The position, under the ticket.
 *
 * "Cost basis" rather than "entry", because it is already all-in — it is the
 * price the market has to reach for a sale to break even, which is the number
 * that matters and is not quite the price on the chart when you bought.
 */
function Position({ price }: { price: number | undefined }) {
  const { account, hydrated } = usePaperAccount();
  const { sol, costBasis, usdc, realisedUsd } = account;

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
            <dd className={`font-mono font-bold tabular-nums ${pnl >= 0 ? "text-up" : "text-down"}`}>
              {pnl >= 0 ? "+" : "−"}
              {usd(Math.abs(pnl))} ({pct(pnlPct, false)})
            </dd>
          </div>
        )}

        {hydrated && realisedUsd !== 0 && (
          <div className="flex justify-between border-t border-hairline pt-1.5">
            <dt className="text-ash">Booked</dt>
            <dd
              className={`font-mono font-bold tabular-nums ${
                realisedUsd >= 0 ? "text-up" : "text-down"
              }`}
            >
              {realisedUsd >= 0 ? "+" : "−"}
              {usd(Math.abs(realisedUsd))}
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}
