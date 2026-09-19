"use client";

import { useEffect, useMemo, useState } from "react";
import { usePaperAccount } from "@/lib/account/store";
import { roundTrips, type RoundTrip } from "@/lib/account/roundtrips";
import { baseSymbol, marketByMint } from "@/lib/chain/markets";
import { useTriggers } from "@/lib/triggers/store";
import { compactUsd, since, units, usd } from "@/lib/format";
import { resolve, type Rule } from "@cipher/shared";
import { CoinMark } from "./coin-mark";
import { useSolPrices } from "./sol-prices";
import { useTokenMeta } from "./use-token-meta";
import { useNow } from "./use-now";

/**
 * YOUR POSITIONS — open, pending, closed.
 *
 * fomo's card has two tabs. This has three, and the middle one is the reason
 * the card is worth building rather than copying: cipher arms orders that have
 * not happened yet. A resting limit buy is a position you have decided on and
 * are waiting for, and until now it existed only in the alerts panel, filed
 * under "rules" — which is what it is to the engine and not what it is to the
 * person who typed it.
 *
 *   OPEN      coins you hold, marked at the live price
 *   PENDING   orders that have not filled: buys that will open a position,
 *             and exits that will close one
 *   CLOSED    round trips, flat to flat, with what the ledger actually booked
 *
 * THE THREE ARE THE LIFE OF A POSITION IN ORDER, which is why they are tabs on
 * one card rather than three panels. A trade moves left to right through them
 * and appears in exactly one at a time.
 */

type Tab = "open" | "pending" | "closed";

const TABS: { key: Tab; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "pending", label: "Pending" },
  { key: "closed", label: "Closed" },
];

export function Positions() {
  const [tab, setTab] = useState<Tab>("open");
  const { account, hydrated } = usePaperAccount();
  const { armed, waiting, hydrated: rulesReady } = useTriggers();

  /*
   * The map holds only what is held: execute() deletes a row the moment a
   * position goes flat, so there is no zero to filter out. The guard stays
   * anyway — it costs nothing, and it is the difference between a quiet list
   * and a card claiming a position worth $0.00 if that invariant slips.
   */
  const open = useMemo(
    () => Object.entries(account.positions).filter(([, p]) => p.qty > 0),
    [account.positions],
  );

  const closed = useMemo(
    /* Newest first. The ledger is written forwards; a human reads it
       backwards — the same inversion the swaps table makes. */
    () => roundTrips(account.fills).reverse(),
    [account.fills],
  );

  const counts: Record<Tab, number> = {
    open: open.length,
    pending: armed.length + waiting.length,
    closed: closed.length,
  };

  return (
    <section className="flex shrink-0 flex-col gap-2.5 rounded-2xl border border-line bg-panel p-2.5">
      <div className="flex items-center justify-between gap-2">
        {/* The sans, for the same reason "About SOL" uses it: Caacupé One is a
            display face cut for the wordmark, and every card title in the
            terminal is set in the sans. */}
        <h2 className="font-sans text-[16px] font-bold text-champagne">Your positions</h2>

        {/*
          * THE SEGMENTED CONTROL.
          *
          * Built on the same raised-chip idiom as the window chips on the
          * About card eight pixels below, rather than on fomo's blue pill —
          * two different active-state treatments stacked in one column read as
          * two different products. cipher's blue is `action`, which means
          * "this is a link"; a tab is not one.
          *
          * The counts are not decoration. "Pending 2" is the answer to the
          * question the tab exists for, so putting it on the tab means the
          * common case — nothing waiting — needs no click to establish.
          */}
        <div
          role="tablist"
          aria-label="Position state"
          className="flex shrink-0 items-center gap-0.5 rounded-lg bg-slate p-0.5"
        >
          {TABS.map((t) => {
            const on = tab === t.key;
            const n = counts[t.key];
            return (
              <button
                key={t.key}
                role="tab"
                aria-selected={on}
                onClick={() => setTab(t.key)}
                className={`flex h-6 items-center gap-1 rounded-[6px] px-2 font-sans text-[11.5px] font-semibold transition-colors ${
                  on ? "bg-raised text-champagne" : "text-mute hover:text-ash"
                }`}
              >
                {t.label}
                {n > 0 && (
                  <span className={`tabular-nums ${on ? "text-ash" : "text-mute"}`}>{n}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/*
        * Hydration is per-source, because the two arrive separately: the
        * account is read from localStorage or Postgres, the rules from the
        * trigger store. Gating the whole card on both would leave Open saying
        * "reading…" because the rules were slow.
        */}
      {tab === "open" && <Open held={open} ready={hydrated} />}
      {tab === "pending" && <Pending armed={armed} waiting={waiting} ready={rulesReady} />}
      {tab === "closed" && <Closed trips={closed} ready={hydrated} />}
    </section>
  );
}

/* ---------------------------------------------------------------- open --- */

/**
 * ONE OPEN POSITION, in the layout the user supplied.
 *
 * Value and quantity on the left, P&L and percent on the right, a dashed
 * hairline, then entry and invested along the bottom. The CSS lives in
 * globals.css under `.pnl` with its geometry untouched — every length is an
 * em off one knob, so the proportions hold at any size.
 *
 * The caret is the reference's SVG rather than a ▲ glyph: a text triangle is
 * a different shape and a different baseline in every browser, and this one
 * rotates for a loss instead of being a second character.
 */
function PositionCard({
  symbol,
  icon,
  qty,
  costBasis,
  mark,
  supply,
  mint,
}: {
  symbol: string;
  icon: string | null;
  qty: number;
  costBasis: number;
  /** Null while the price poll has not answered for this mint. */
  mark: number | null;
  supply: number | null;
  mint: string;
}) {
  /*
   * A MISSING MARK IS NOT A ZERO. The poll has not answered yet, or Jupiter
   * has no route for this token today; either way the position is worth an
   * unknown amount, and writing that down as nothing shows someone their
   * money vanishing because a request was slow. `equity()` skips it too.
   */
  const value = mark === null ? null : qty * mark;
  const invested = qty * costBasis;
  const pnl = value === null ? null : value - invested;
  const pnlPct = pnl === null || invested <= 0 ? null : (pnl / invested) * 100;
  const down = pnl !== null && pnl < 0;
  /* The coin's whole market cap, at the price this card is marked at. */
  const cap = mark !== null && supply !== null ? supply * mark : null;

  /*
   * AVERAGE ENTRY, BOTH WAYS AT ONCE.
   *
   * This followed the chart's Price/MCap toggle and showed one or the other.
   * Showing both is simply better here and the toggle was the wrong master
   * for it: the price is what the P&L is arithmetically computed from, and
   * the cap is what places the entry against where the coin is now — "I got
   * in at $1.4M" against a $4M coin says the whole story, and "$0.0000041"
   * says none of it. They are the same fact times supply, so there is no risk
   * of them disagreeing.
   *
   * The cap is dropped rather than guessed when no supply is known, which is
   * every Binance major and any token whose lookup failed.
   */
  const entryCap = supply !== null ? `${compactUsd(costBasis * supply)} MC` : null;

  return (
    <div className={`pnl ${down ? "is-down" : ""}`}>
      <div className="pnl__top">
        <div className="pnl__col min-w-0">
          <div className="pnl__value">{value === null ? "—" : usd(value)}</div>
          {/*
            * WHAT YOU HOLD, THEN WHAT IT IS WORTH AS A WHOLE.
            *
            * The reference puts one line here. Two, because they answer
            * different questions: the first is your position, the second is
            * the coin's own size, and a memecoin's cap is the number people
            * quote it by — "I'm in 19M WIFOUT" means nothing without "and
            * it's a $4M coin".
            *
            * THE TICKER, not the full name. This briefly read "4.9745 Solana"
            * on the theory that the card had the width for a sentence; the
            * ticker is what the position is called everywhere else on the
            * screen — the ticket, the chart header, the swaps table — and a
            * card that renames the coin is a card you have to translate. The
            * mark is here because the column lists several positions and an
            * unnamed card stops working at two.
            */}
          <div className="pnl__sub flex items-center gap-1.5">
            <CoinMark symbol={symbol} icon={icon} size={14} />
            <span className="truncate">
              {units(qty)} {symbol}
            </span>
          </div>
          {/*
            * LIVE, not the `fdv` the token payload was fetched with.
            *
            * supply × the same mark the value above is computed from, so the
            * two numbers on this card can never be minutes apart — and a cap
            * that updates while the position does not would be the more
            * confusing of the two failures.
            */}
          {cap !== null && <div className="pnl__sub pnl__sub--cap">{compactUsd(cap)} MC</div>}
        </div>
        <div className="pnl__col pnl__col--right">
          <div className="pnl__value pnl__value--gain">
            {pnl === null ? "—" : `${down ? "−" : "+"}${usd(Math.abs(pnl))}`}
          </div>
          <div className="pnl__sub pnl__sub--gain">
            {pnlPct !== null && (
              <svg className="pnl__caret" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true">
                <path d="M5 1.2 9.2 8.4H0.8z" />
              </svg>
            )}
            {pnlPct === null ? "—" : `${Math.abs(pnlPct).toFixed(2)}%`}
          </div>
        </div>
      </div>

      <div className="pnl__rule" />

      <div className="pnl__foot">
        {/* The cap stacks UNDER the entry price rather than beside it, so
            "Invested" keeps the bottom-right corner the reference gives it.
            Baseline alignment on the row means Invested lines up with the
            price, not with the cap below it. */}
        <div className="pnl__pair">
          <span className="pnl__label">Avg. entry</span>
          <span className="pnl__stack">
            <span className="pnl__stat">{usd(costBasis)}</span>
            {entryCap && <span className="pnl__stat pnl__stat--cap">{entryCap}</span>}
          </span>
        </div>
        <div className="pnl__pair">
          <span className="pnl__label">Invested</span>
          <span className="pnl__stat">{usd(invested)}</span>
        </div>
      </div>

      {/* Below the card's own rows rather than in them, so the layout the
          user approved is untouched and the button is simply added. */}
      <div className="pnl__actions">
        <SellAll mint={mint} symbol={symbol} qty={qty} mark={mark} />
      </div>
    </div>
  );
}

/**
 * SELL THE WHOLE POSITION, AT MARKET — in two taps.
 *
 * The first tap only asks. A single tap that sells everything sits a few
 * pixels from a tab switch, and a paper account is still someone's practice
 * money; the header's Reset makes the same trade-off for the same reason.
 * The confirmation lapses after four seconds so a stray tap cannot be
 * finished by another one a minute later.
 *
 * All of it, at market, because that is the one sell with no question left
 * in it. A partial or a limit sell is a sentence for Sana, which already
 * knows how to say every size and every price.
 */
function SellAll({
  mint,
  symbol,
  qty,
  mark,
}: {
  mint: string;
  symbol: string;
  qty: number;
  mark: number | null;
}) {
  const { trade } = usePaperAccount();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);

  useEffect(() => {
    if (!asking) return;
    const t = setTimeout(() => setAsking(false), 4000);
    return () => clearTimeout(t);
  }, [asking]);

  useEffect(() => {
    if (!said) return;
    const t = setTimeout(() => setSaid(null), 5000);
    return () => clearTimeout(t);
  }, [said]);

  /* No price, no sell: a market order needs a mark to fill against. */
  if (mark === null) return null;

  const onClick = async () => {
    if (!asking) return setAsking(true);
    setAsking(false);
    setBusy(true);
    const r = await trade({ mint, symbol, side: "sell", qty, mark, source: "ticket" });
    setBusy(false);
    if ("refusal" in r) setSaid(r.refusal);
  };

  return (
    <>
      {said && <span className="pnl__label mr-auto self-center truncate">{said}</span>}
      <button
        onClick={onClick}
        disabled={busy}
        className={`pnl__btn ${asking ? "pnl__btn--armed" : ""}`}
      >
        {busy ? "Selling…" : asking ? `Sell ${units(qty)} ${symbol}?` : "Sell"}
      </button>
    </>
  );
}

function Open({
  held,
  ready,
}: {
  held: [string, { qty: number; costBasis: number }][];
  ready: boolean;
}) {
  const mints = held.map(([mint]) => mint);
  /*
   * Registered under this panel's own key, so the shared poll fetches the
   * union of what the chart is showing and what you hold. A coin you bought
   * and then navigated away from still has a live price here — which is the
   * entire point of a holdings list, and would not be true if this read only
   * the open market's mark.
   */
  const marks = useSolPrices("positions", mints);
  const meta = useTokenMeta(mints);

  if (!ready) return <Quiet>Reading your account…</Quiet>;
  if (held.length === 0) {
    return (
      <Quiet>
        No open positions. Buy something on the ticket above, or tell Sana what you want.
      </Quiet>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {held.map(([mint, p]) => (
        <PositionCard
          key={mint}
          symbol={meta[mint]?.symbol ?? mint}
          icon={meta[mint]?.icon ?? null}
          qty={p.qty}
          costBasis={p.costBasis}
          mark={marks[mint]?.usd ?? null}
          supply={meta[mint]?.supply ?? null}
          mint={mint}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------- pending --- */

/*
 * What an order is, in the user's four words (19 Sep 2026).
 *
 *   Buy limit        a resting buy
 *   Sell stop loss   a sell BELOW the price it was measured from
 *   Sell target      a sell above it, set together with a buy
 *   Sell limit       a sell above it, set on its own later
 *
 * Target and limit fire identically; the user's distinction is only WHEN the
 * order was given, and parentId carries that — a resting buy's id, or the
 * fill id of the market buy the exit came with (see sana.tsx).
 */
type Kind = "Buy limit" | "Sell stop loss" | "Sell target";

function kindOf(rule: Rule, at: number | null, reference: number | null): Kind {
  if (rule.side === "buy") return "Buy limit";
  const t = rule.trigger;
  const below =
    t.kind === "drawdownFromEntry" ||
    t.kind === "trailingStop" ||
    (t.kind === "priceMultiple" && t.value < 1) ||
    (at !== null && reference !== null && at < reference);
  if (below) return "Sell stop loss";
  /* A sell limit IS a sell target — the user's call, 19 Sep 2026: one name
     for a sell above the market, whenever it was set. */
  return "Sell target";
}

/**
 * How many tokens an order moves, as a number — never "30% of your SOL".
 *
 * `exact` is false where the number is a projection: a buy sized in dollars
 * (the tokens depend on the fill), or an exit still waiting for its buy.
 */
function quantityOf(
  rule: Rule,
  at: number | null,
  held: number,
  parentQty: number | null,
): { qty: number | null; exact: boolean } {
  const a = rule.amount;
  switch (a.kind) {
    case "tokens":
      return { qty: a.value, exact: true };
    case "usd":
      return { qty: at ? a.value / at : null, exact: false };
    case "percentOfPosition":
      /* Frozen at bind for exits waiting on a buy; until then, a share of
         what that buy is expected to deliver. Anything else still carrying a
         percentage predates freezing and resolves against the holding. */
      if (rule.state === "unbound") {
        return { qty: parentQty === null ? null : (parentQty * a.value) / 100, exact: false };
      }
      return { qty: (held * a.value) / 100, exact: true };
  }
}

/** Mirrors SELL_TOLERANCE in lib/triggers/execute.ts — the note and the engine must agree. */
const SELL_TOLERANCE = 0.005;

function Pending({ armed, waiting, ready }: { armed: Rule[]; waiting: Rule[]; ready: boolean }) {
  const { cancelRule, thresholdOf, server, watching, rulesById } = useTriggers();
  const { account } = usePaperAccount();

  /* Buys first — they open the positions the exits below them will close. */
  const rules = useMemo(
    () => [
      ...armed.filter((r) => r.side === "buy"),
      ...armed.filter((r) => r.side === "sell"),
      ...waiting,
    ],
    [armed, waiting],
  );
  const mints = useMemo(() => [...new Set(rules.map((r) => r.market))], [rules]);
  const meta = useTokenMeta(mints);
  /* The live price for every coin with an order, so each card shows where
     the market is now against where the order fires. */
  const marks = useSolPrices("pending", mints);

  if (!ready) return <Quiet>Reading your rules…</Quiet>;
  if (rules.length === 0) {
    return (
      <Quiet>
        Nothing pending. A limit order rests here until its price arrives — try{" "}
        <span className="text-champagne">&ldquo;buy $500 of SOL at $95&rdquo;</span>.
      </Quiet>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {/*
        * THE DEADMAN'S SWITCH, repeated from the alerts panel on purpose.
        * Everything on this tab implies "something is watching this"; when
        * that stops being true it stops silently.
        */}
      {server && !watching && armed.length > 0 && (
        <p className="rounded-lg border border-down/30 bg-down/10 px-2 py-1.5 font-sans text-[11px] font-bold text-down">
          Rules are not being watched right now — nothing fires until the service checks in.
        </p>
      )}

      {rules.map((rule) => {
        /*
         * An exit waiting on a resting buy has no entry yet, so it is priced
         * off the buy's limit — what the fill will be, near enough, and far
         * better than showing no price at all.
         */
        const parent =
          rule.state === "unbound" && rule.parentId ? rulesById[rule.parentId] : undefined;
        const parentAt = parent ? thresholdOf(parent) : null;
        let at = thresholdOf(rule);
        if (at === null && parentAt !== null) {
          const r = resolve(rule.trigger, parentAt, Date.now());
          at = r.kind === "price" ? r.at : null;
        }
        const parentQty = parent ? quantityOf(parent, parentAt, 0, null).qty : null;
        const held = account.positions[rule.market]?.qty ?? 0;

        return (
          <PendingCard
            key={rule.id}
            rule={rule}
            kind={kindOf(rule, at, rule.entryPrice ?? parentAt)}
            at={at}
            quantity={quantityOf(rule, at, held, parentQty)}
            held={held}
            waitingOn={parentAt}
            symbol={meta[rule.market]?.symbol ?? baseSymbol(rule.market)}
            icon={meta[rule.market]?.icon ?? null}
            supply={meta[rule.market]?.supply ?? null}
            mark={marks[rule.market]?.usd ?? null}
            onCancel={() => cancelRule(rule.id)}
          />
        );
      })}
    </div>
  );
}

function PendingCard({
  rule,
  kind,
  at,
  quantity,
  held,
  waitingOn,
  symbol,
  icon,
  supply,
  mark,
  onCancel,
}: {
  rule: Rule;
  kind: Kind;
  at: number | null;
  quantity: { qty: number | null; exact: boolean };
  held: number;
  /** The resting buy's price, when this exit is waiting for it. */
  waitingOn: number | null;
  symbol: string;
  icon: string | null;
  supply: number | null;
  /** The live price. Null while the poll has not answered. */
  mark: number | null;
  onCancel: () => void;
}) {
  const { qty, exact } = quantity;
  const approx = exact ? "" : "≈ ";
  const cap = at !== null && supply !== null ? at * supply : null;
  const worth =
    qty !== null && at !== null
      ? qty * at
      : rule.amount.kind === "usd"
        ? rule.amount.value
        : null;
  const tone = kind === "Sell stop loss" ? "down" : kind === "Buy limit" ? null : "up";

  /*
   * THE USER'S RULE, SAID ON THE CARD: a sell executes only with the full
   * quantity held. When it is not, the order stays here and says exactly
   * what it is waiting for, in tokens.
   */
  let note: { text: string; quiet: boolean } | null = null;
  if (rule.state === "unbound") {
    note = {
      text:
        waitingOn !== null
          ? `Arms when your buy at ${usd(waitingOn)} fills.`
          : "Arms when your buy fills.",
      quiet: true,
    };
  } else if (rule.side === "sell" && qty !== null && held < qty * (1 - SELL_TOLERANCE)) {
    note = {
      text: `Cannot be executed unless you have ${units(qty)} ${symbol}. You have ${units(held)}.`,
      quiet: false,
    };
  }

  return (
    <div className="pnl">
      <div className="pnl__top">
        <div className="pnl__col min-w-0">
          <div className={`pnl__value pnl__kind ${tone ? `pnl__kind--${tone}` : ""}`}>{kind}</div>
          <div className="pnl__sub flex items-center gap-1.5">
            <CoinMark symbol={symbol} icon={icon} size={14} />
            <span className="truncate">
              {qty === null ? "—" : `${approx}${units(qty)}`} {symbol}
            </span>
          </div>
        </div>
        <div className="pnl__col pnl__col--right">
          <div className="pnl__value">{at === null ? timeOf(rule) : usd(at)}</div>
          {cap !== null && <div className="pnl__sub">{compactUsd(cap)} MC</div>}
          <div className="pnl__label">Trigger</div>
        </div>
      </div>

      {note && (
        <div className={`pnl__note ${note.quiet ? "pnl__note--quiet" : ""}`}>{note.text}</div>
      )}

      <div className="pnl__rule" />

      <div className="pnl__foot">
        {/* WHERE THE MARKET IS NOW, against the trigger price above — the
            user's layout, 19 Sep 2026: quantity, token, trigger price and
            current price, both in USD, with the market cap for each. */}
        <div className="pnl__pair">
          <span className="pnl__label">Now</span>
          <span className="pnl__stack">
            <span className="pnl__stat">{mark === null ? "—" : usd(mark)}</span>
            {mark !== null && supply !== null && (
              <span className="pnl__stat pnl__stat--cap">{compactUsd(mark * supply)} MC</span>
            )}
          </span>
        </div>
        <button onClick={onCancel} className="pnl__btn">
          Cancel
        </button>
      </div>
    </div>
  );
}

/** A timed exit has no price; its moment is the number. */
function timeOf(rule: Rule): string {
  const t = rule.trigger;
  if (t.kind === "timeAbsolute") {
    return new Date(t.iso).toLocaleString([], { dateStyle: "short", timeStyle: "short" });
  }
  if (t.kind === "duration") return `${Math.round(t.seconds / 60)} min`;
  return "—";
}

/* -------------------------------------------------------------- closed --- */

/**
 * A ROUND TRIP, on the same card as an open position.
 *
 * Mapped field for field so the eye finds the same thing in the same place:
 * what it is worth (here, what came back), the P&L and its percent, the
 * entry — with the average exit stacked where the open card stacks the
 * entry's market cap — and what went in, bottom right.
 */
function Closed({ trips, ready }: { trips: RoundTrip[]; ready: boolean }) {
  const mints = useMemo(() => [...new Set(trips.map((t) => t.mint))], [trips]);
  const meta = useTokenMeta(mints);
  /* Thirty seconds, not one. "4h ago" does not change often enough to justify
     re-rendering a list every second. */
  const now = useNow(30_000);

  if (!ready) return <Quiet>Reading your account…</Quiet>;
  if (trips.length === 0) {
    return <Quiet>Nothing closed yet. A position lands here once you are flat again.</Quiet>;
  }

  return (
    <div className="flex flex-col gap-2">
      {trips.map((t) => {
        const listed = marketByMint(t.mint);
        const symbol = meta[t.mint]?.symbol ?? t.mint;
        const down = t.realisedUsd < 0;
        const entry = t.qtyBought > 0 ? t.investedUsd / t.qtyBought : null;
        const exit = t.qtySold > 0 ? t.proceedsUsd / t.qtySold : null;
        return (
          <div key={`${t.mint}-${t.closedAt}`} className={`pnl ${down ? "is-down" : ""}`}>
            <div className="pnl__top">
              <div className="pnl__col min-w-0">
                <div className="pnl__value">{usd(t.proceedsUsd)}</div>
                <div className="pnl__sub flex items-center gap-1.5">
                  <CoinMark
                    symbol={symbol}
                    icon={meta[t.mint]?.icon ?? null}
                    hue={listed?.hue}
                    glyph={listed?.glyph}
                    size={14}
                  />
                  <span className="truncate">
                    {units(t.qtySold)} {symbol}
                  </span>
                </div>
                {/* How long it was held, and how long ago it ended — the two
                    facts that place a closed trade without a date. */}
                <div className="pnl__sub pnl__sub--cap">
                  held {since(t.openedAt, t.closedAt * 1000) || "<1m"}
                  {now !== null && ` · ${since(t.closedAt, now)} ago`}
                </div>
              </div>
              <div className="pnl__col pnl__col--right">
                <div className="pnl__value pnl__value--gain">
                  {down ? "−" : "+"}
                  {usd(Math.abs(t.realisedUsd))}
                </div>
                <div className="pnl__sub pnl__sub--gain">
                  {t.returnPct !== null && (
                    <svg className="pnl__caret" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true">
                      <path d="M5 1.2 9.2 8.4H0.8z" />
                    </svg>
                  )}
                  {t.returnPct === null ? "—" : `${Math.abs(t.returnPct).toFixed(2)}%`}
                </div>
              </div>
            </div>

            <div className="pnl__rule" />

            <div className="pnl__foot">
              <div className="pnl__pair">
                <span className="pnl__label">Avg. entry</span>
                <span className="pnl__stack">
                  <span className="pnl__stat">{entry === null ? "—" : usd(entry)}</span>
                  {exit !== null && (
                    <span className="pnl__stat pnl__stat--cap">exit {usd(exit)}</span>
                  )}
                </span>
              </div>
              <div className="pnl__pair">
                <span className="pnl__label">Invested</span>
                <span className="pnl__stat">{usd(t.investedUsd)}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* --------------------------------------------------------------- parts --- */

/** Every empty and loading state, one shape. */
function Quiet({ children }: { children: React.ReactNode }) {
  return (
    <p className="py-6 text-center font-sans text-[12px] leading-relaxed text-mute">{children}</p>
  );
}
