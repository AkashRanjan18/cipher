"use client";

import { useState } from "react";
import { usePaperAccount } from "@/lib/account/store";
import { useTriggers } from "@/lib/triggers/store";
import {
  quote,
  fillPrice,
  maxBuyUsd,
  unrealised,
  equity,
  allInPrice,
} from "@/lib/account/paper";
import { usd, pct } from "@/lib/format";
import { DEFAULTS } from "@cipher/shared";

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

/**
 * Market or limit.
 *
 * Market is the only one that can execute today: a limit order that is not
 * immediately fillable has to REST, and resting means something watches the
 * price and fires later. That is the trigger engine, and it does not exist
 * yet — the same reason Sana refuses to arm exits.
 *
 * A marketable limit is different and does work: a buy limit at or above the
 * current price, or a sell limit at or below it, can be filled right now. So
 * the tab is not decoration — roughly half the orders people type into it
 * will go through.
 */
type OrderType = "market" | "limit";

const BUY_PRESETS = [10, 100, 500, 1000];
const SELL_PRESETS = [25, 50, 75, 100];

/**
 * Slippage presets, in bps.
 *
 * fomo puts this behind a gear beside the amount presets and picks the default
 * for you, which is the right call: most people set it worse than the default
 * would have been, and on a public mempool a wide tolerance is not a safety
 * margin — it is the budget you are offering a sandwich bot.
 *
 * The four are the real decision points. 0.5% is a deep liquid major, 1% is
 * normal, 3% is our default and lands on a moving memecoin, 10% is "I need
 * this fill and I know what it costs".
 */
const SLIPPAGE_PRESETS = [50, 100, 300, 1000];

export function Ticket({
  price,
  solPrice,
  symbol,
  market = "SOL",
  depthUsd = null,
}: {
  price: number | undefined;
  /**
   * SOL's own price, whatever market is open.
   *
   * `price` is the CHART's price and is what an order is filled at; this is
   * what the POSITION is worth. They are the same number only while SOL is
   * open, and using one for the other valued four SOL at BTC's price — an
   * account panel reading +75,295%.
   */
  solPrice?: number;
  /** The market's id, e.g. "SOLUSDT" — what a resting order watches. */
  symbol: string;
  /** The market the chart is showing. See tradable below. */
  market?: string;
  /** Resting book depth, for pricing this order's impact. Null when unknown. */
  depthUsd?: number | null;
}) {
  const { account, hydrated, trade } = usePaperAccount();
  const { armEntry } = useTriggers();
  const [side, setSide] = useState<Side>("buy");
  const [orderType, setOrderType] = useState<OrderType>("market");
  /* Defaults come from packages/shared, not from a literal here, so the ticket
     and the prompt compiler can never disagree about what "unstated" means. */
  /* Explicit generics: DEFAULTS is `as const`, so these infer as the literal
     types 300 and true and then refuse every other value. Widen here rather
     than loosening the constant — it being literal is what makes it a
     constant. */
  const [slippageBps, setSlippageBps] = useState<number>(DEFAULTS.slippageBps);
  const [privateSubmission, setPrivateSubmission] = useState<boolean>(
    DEFAULTS.privateSubmission,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [limit, setLimit] = useState("");
  const [amount, setAmount] = useState("");
  const [receipt, setReceipt] = useState<{ ok: boolean; text: string } | null>(null);
  /*
   * Set only by the 100% preset. "Sell everything" is a quantity instruction,
   * and routing it through the USD box rounds it to the cent and converts it
   * back, leaving a few millionths of a SOL behind.
   */
  const [sellAll, setSellAll] = useState(false);

  /*
   * The ledger holds ONE asset.
   *
   * The left panel became a navigator, so the chart can now show BTC — but
   * lib/account/paper.ts keeps a single `sol` balance with a single cost
   * basis. Buying while another market is open would credit SOL at BTC's
   * price and silently corrupt every downstream number: the position card,
   * the P&L, the equity in the header.
   *
   * Refusing is the honest version, and it is two lines. The fix is the one
   * paper.ts already names — holdings becomes a map keyed by mint — and it is
   * a real piece of work, not something to slip in behind a layout change.
   */
  const tradable = market === "SOL";

  const buying = side === "buy";
  const value = parseFloat(amount.replace(/,/g, "")) || 0;
  const limitPrice = parseFloat(limit.replace(/,/g, "")) || 0;
  const limiting = orderType === "limit";

  /*
   * Would this limit fill right now?
   *
   * A buy limit is marketable at or ABOVE the market — you are willing to pay
   * more than it costs, so it crosses. A sell limit is marketable at or below.
   * The inverted case is the one that has to rest, and resting is what we
   * cannot do yet.
   */
  const marketable =
    !limiting ||
    !price ||
    limitPrice <= 0 ||
    (buying ? limitPrice >= price : limitPrice <= price);

  /* How far the limit sits from the market, for the hint under the box. */
  const limitGapPct =
    price && limitPrice > 0 ? ((limitPrice - price) / price) * 100 : null;

  const qty = !price ? 0 : sellAll && !buying ? account.sol : value / fillPrice(price, side);
  const q = price ? quote(account, side, qty, price, { depthUsd, slippageBps }) : null;

  /* Only block on a refusal once the real balance is known. Before hydration
     the account is the opening default, and refusing against it would be a
     refusal about the wrong account. */
  /*
   * A resting limit used to be a refusal. Now it is the point.
   *
   * The message said "nothing is watching the price yet", which was true and
   * is not any more — the engine holds it and fires on the crossing. The
   * refusal is gone and the button changes what it does instead.
   */
  const resting = limiting && limitPrice > 0 && !marketable;

  const blocked = hydrated ? (resting ? null : (q?.refusal ?? null)) : null;

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

    /*
     * A limit on the wrong side of the market does not trade — it waits.
     *
     * Same machine the prompt bar arms, same state, same alerts row. A ticket
     * and a sentence must never be two different order systems that happen to
     * agree; they are one system with two front doors.
     */
    if (resting) {
      armEntry({
        rule: {
          id: `t${Date.now()}`,
          trigger: { kind: "priceAbsolute", value: limitPrice },
          amount: buying
            ? { kind: "usd", value }
            : { kind: "tokens", value: qty },
        },
        market: symbol,
        referencePrice: price,
        side,
      });
      setSellAll(false);
      setAmount("");
      setReceipt({
        ok: true,
        text: `Resting. I'll ${side} when ${market} reaches ${usd(limitPrice)}.`,
      });
      return;
    }

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
     * shrink-0 and NO overflow: the column around this scrolls now, not the
     * ticket. See the aside in terminal.tsx.
     *
     * [&>*]:shrink-0 on the children stays, and is not decoration. In a flex
     * column, children are free to compress to fit — and a child carrying
     * overflow-hidden has no content floor to push back with. The position
     * card once collapsed to 2.65px tall: present in the DOM, correct in every
     * number, and invisible.
     */
    <div className="flex shrink-0 flex-col gap-2.5 rounded-2xl border border-line bg-panel p-3 [&>*]:shrink-0">
      {/*
        * Order type sits ABOVE side, because it is the wider decision: it
        * changes what the ticket asks you for, while side only changes which
        * direction the same question runs in. A segmented strip rather than
        * two more big buttons — three stacked pairs of equal-weight buttons
        * and the eye has no idea which one is the primary control.
        */}
      <div className="flex gap-0.5 rounded-lg bg-slate p-0.5">
        {(["market", "limit"] as const).map((t) => (
          <button
            key={t}
            onClick={() => {
              setOrderType(t);
              setReceipt(null);
              if (t === "market") setLimit("");
              // Seed the box with the live price so the first edit is a nudge
              // from where the market actually is, not a guess from zero.
              if (t === "limit" && price) setLimit(price.toFixed(price >= 1 ? 2 : 6));
            }}
            aria-pressed={orderType === t}
            className={`flex-1 rounded-md py-1 font-sans text-[11.5px] font-bold capitalize transition-colors ${
              orderType === t ? "bg-raised text-champagne" : "text-ash hover:text-champagne"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

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
                  ? "border-up/50 bg-up-soft text-up"
                  : "border-down/50 bg-down-soft text-down"
                : "border-line bg-slate text-ash hover:text-champagne"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {limiting && (
        <div>
          <div className="flex items-center gap-2 rounded-xl border border-line bg-slate px-3.5 py-2 focus-within:border-accent/50">
            <label
              htmlFor="tk-limit"
              className="shrink-0 font-sans text-[10px] font-bold uppercase tracking-[0.11em] text-ash"
            >
              Limit
            </label>
            <input
              id="tk-limit"
              inputMode="decimal"
              value={limit}
              onChange={(e) => {
                if (e.target.value === "" || /^\d*\.?\d*$/.test(e.target.value)) {
                  setLimit(e.target.value);
                  setReceipt(null);
                }
              }}
              placeholder="0.00"
              className="min-w-0 flex-1 bg-transparent text-right font-mono text-[15px] font-bold tabular-nums text-champagne placeholder:text-ash focus:outline-none"
            />
          </div>
          {/* Distance from the market, signed and coloured. A price in
              isolation says nothing; the gap is the whole decision. */}
          {limitGapPct !== null && (
            <p
              className={`mt-1 px-1 font-mono text-[10.5px] tabular-nums ${
                marketable ? "text-ash" : buying ? "text-down" : "text-up"
              }`}
            >
              {limitGapPct >= 0 ? "+" : "−"}
              {Math.abs(limitGapPct).toFixed(2)}% vs market
              {marketable && limitPrice > 0 ? " · fills now" : ""}
            </p>
          )}
        </div>
      )}

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

      <div className="relative flex items-center gap-1.5">
        {(buying ? BUY_PRESETS : SELL_PRESETS).map((n) => (
          <button
            key={n}
            onClick={() => preset(n)}
            className="flex-1 rounded-lg border border-line bg-slate py-1.5 font-sans text-[11.5px] font-bold text-champagne transition-colors hover:border-ash"
          >
            {buying ? `$${n}` : `${n}%`}
          </button>
        ))}

        {/*
          * The gear, where fomo puts it: beside the presets, out of the path.
          *
          * Slippage and routing do not belong in the main flow. Most people
          * set them worse than the default would have been, and on a public
          * mempool a wide tolerance is not a safety margin — it is the budget
          * you are offering a sandwich bot. Pick well, hide it, let the ones
          * who know go looking.
          */}
        <button
          onClick={() => setSettingsOpen((o) => !o)}
          aria-expanded={settingsOpen}
          aria-label="Execution settings"
          title={`${(slippageBps / 100).toFixed(2)}% slippage · ${privateSubmission ? "private" : "public"}`}
          className={`shrink-0 rounded-lg border px-2 py-1.5 font-mono text-[12px] transition-colors ${
            settingsOpen
              ? "border-accent/50 bg-raised text-accent"
              : "border-line bg-slate text-ash hover:text-champagne"
          }`}
        >
          ⚙
        </button>

        {settingsOpen && (
          <div className="absolute right-0 top-full z-30 mt-1.5 w-full rounded-xl border border-line bg-panel p-3 shadow-2xl">
            <div className="flex items-baseline justify-between">
              <span className="font-sans text-[10px] font-bold uppercase tracking-[0.11em] text-ash">
                Max slippage
              </span>
              <span className="font-mono text-[11px] tabular-nums text-champagne">
                {(slippageBps / 100).toFixed(2)}%
              </span>
            </div>

            <div className="mt-1.5 flex gap-1">
              {SLIPPAGE_PRESETS.map((bps) => (
                <button
                  key={bps}
                  onClick={() => setSlippageBps(bps)}
                  aria-pressed={slippageBps === bps}
                  className={`flex-1 rounded-lg border py-1 font-mono text-[11px] tabular-nums transition-colors ${
                    slippageBps === bps
                      ? "border-accent/50 bg-accent/10 text-accent"
                      : "border-line bg-slate text-ash hover:text-champagne"
                  }`}
                >
                  {bps / 100}%
                </button>
              ))}
            </div>

            {/* Routing. Private is the default and the label says what it
                buys, because "private submission" means nothing to anyone who
                has not already been sandwiched. */}
            <label className="mt-3 flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                checked={privateSubmission}
                onChange={(e) => setPrivateSubmission(e.target.checked)}
                className="peer sr-only"
              />
              <span
                aria-hidden
                className={`mt-px grid h-3.5 w-3.5 shrink-0 place-items-center rounded-[4px] border text-[9px] font-bold transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-accent ${
                  privateSubmission
                    ? "border-action bg-action text-white"
                    : "border-line bg-slate text-transparent"
                }`}
              >
                ✓
              </span>
              <span className="font-sans text-[11px] leading-snug text-ash">
                <b className="font-bold text-champagne">Private submission</b>
                <br />
                Hides the order until it lands, so nothing can trade in front of it.
              </span>
            </label>

            {/* cipher: neither setting reaches an execution path yet — the
                paper account models impact from book depth, and there is no
                mempool to be private from. They are stored, shown, and
                enforced against the impact model; they become real with the
                relayer. */}
            <p className="mt-2.5 border-t border-hairline pt-2 font-sans text-[10px] leading-relaxed text-mute">
              Applied to the impact model on paper. Real routing lands with the
              Solana engine.
            </p>
          </div>
        )}
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
        // A limit order with no limit price would fall through and submit as
        // a market order — the one substitution a ticket must never make.
        disabled={
          !tradable || !price || !!blocked || value <= 0 || (limiting && limitPrice <= 0)
        }
        onClick={submit}
        className={`rounded-xl py-3 font-display text-[15px] font-bold transition-transform active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-40 ${
          !tradable
            ? "cursor-not-allowed bg-raised text-mute"
            : buying
              ? "bg-up text-ink"
              : "bg-down text-ink"
        }`}
      >
        {!tradable
          ? `${market} is chart-only`
          : resting
            ? `Rest ${buying ? "buy" : "sell"} at ${usd(limitPrice)}`
            : `${buying ? "Buy" : "Sell"} SOL${limiting && marketable && limitPrice > 0 ? " at limit" : ""}`}
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

      <Position price={solPrice ?? price} />
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
  /* `price` here is SOL's price, not the chart's — see the Ticket prop. The
     position is SOL whatever market is open. */
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
