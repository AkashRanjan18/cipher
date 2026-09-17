"use client";

import { useMemo, useState } from "react";
import { usePaperAccount } from "@/lib/account/store";
import { roundTrips, type RoundTrip } from "@/lib/account/roundtrips";
import { baseSymbol, marketByMint } from "@/lib/chain/markets";
import type { Denom } from "@/lib/chain/denom";
import { useTriggers } from "@/lib/triggers/store";
import { compactUsd, pct, since, units, usd } from "@/lib/format";
import type { Amount, Rule } from "@cipher/shared";
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

export function Positions({ denom }: { denom: Denom }) {
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
      {tab === "open" && <Open held={open} ready={hydrated} denom={denom} />}
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
  denom,
}: {
  symbol: string;
  icon: string | null;
  qty: number;
  costBasis: number;
  /** Null while the price poll has not answered for this mint. */
  mark: number | null;
  supply: number | null;
  denom: Denom;
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

  /*
   * AVERAGE ENTRY IN WHATEVER THE CHART IS SPEAKING.
   *
   * fomo writes "$1.4M MC" here and that is the more useful number on a
   * memecoin — "I got in at $1.4M" places a position against where the token
   * is now, and "$0.0000041" does not. It is the same fact multiplied by
   * supply, so it is a unit change rather than a second source, and it falls
   * back to the price when no supply is known.
   */
  const entry =
    denom === "mcap" && supply !== null
      ? `${compactUsd(costBasis * supply)} MC`
      : usd(costBasis);

  return (
    <div className={`pnl ${down ? "is-down" : ""}`}>
      <div className="pnl__top">
        <div className="pnl__col min-w-0">
          <div className="pnl__value">{value === null ? "—" : usd(value)}</div>
          {/* The reference puts the holding under the value. The coin's mark
              goes here too, because the column lists several and a card with
              no name on it is unreadable the moment there are two. */}
          <div className="pnl__sub flex items-center gap-1.5">
            <CoinMark symbol={symbol} icon={icon} size={14} />
            {units(qty)} {symbol}
          </div>
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
        <div className="pnl__pair">
          <span className="pnl__label">Avg. entry</span>
          <span className="pnl__stat">{entry}</span>
        </div>
        <div className="pnl__pair">
          <span className="pnl__label">Invested</span>
          <span className="pnl__stat">{usd(invested)}</span>
        </div>
      </div>
    </div>
  );
}

function Open({
  held,
  ready,
  denom,
}: {
  held: [string, { qty: number; costBasis: number }][];
  ready: boolean;
  denom: Denom;
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
          denom={denom}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------- pending --- */

/** "a third", "$500", "1.5 SOL" — the instruction, not the arithmetic. */
function amountLabel(amount: Amount, base: string): string {
  switch (amount.kind) {
    case "usd":
      return `${usd(amount.value)} of ${base}`;
    case "tokens":
      return `${units(amount.value)} ${base}`;
    case "percentOfPosition":
      return amount.value === 100 ? `all of your ${base}` : `${amount.value}% of your ${base}`;
  }
}

function triggerLabel(rule: Rule): string {
  switch (rule.trigger.kind) {
    case "priceMultiple":
      return `at ${rule.trigger.value}x`;
    case "priceAbsolute":
      return `when ${baseSymbol(rule.market)} reaches ${usd(rule.trigger.value)}`;
    case "drawdownFromEntry":
      return `if it falls ${rule.trigger.percent}% from entry`;
    case "trailingStop":
      return `${rule.trigger.percent}% below the high`;
    case "timeAbsolute":
      return `at ${new Date(rule.trigger.iso).toLocaleString()}`;
    case "duration":
      return `${Math.round(rule.trigger.seconds / 60)} minutes after it fills`;
  }
}

function Pending({ armed, waiting, ready }: { armed: Rule[]; waiting: Rule[]; ready: boolean }) {
  const { cancelRule, thresholdOf, server, watching } = useTriggers();

  if (!ready) return <Quiet>Reading your rules…</Quiet>;
  if (armed.length === 0 && waiting.length === 0) {
    return (
      <Quiet>
        Nothing pending. A limit order rests here until its price arrives — try{" "}
        <span className="text-champagne">&ldquo;buy $500 of SOL at $95&rdquo;</span>.
      </Quiet>
    );
  }

  /*
   * SPLIT BY WHAT THEY DO TO A POSITION, not by the engine's own states.
   *
   * A resting buy is a position you do not have yet; an armed sell is one you
   * do. Those are different things to a person reading this card, and
   * "armed" versus "unbound" — the distinction the engine cares about — is
   * not one of them.
   */
  const entries = armed.filter((r) => r.side === "buy");
  const exits = [...armed.filter((r) => r.side === "sell"), ...waiting];

  return (
    <div className="flex flex-col gap-2">
      {/*
        * THE DEADMAN'S SWITCH, repeated from the alerts panel on purpose.
        *
        * Everything on this tab implies "something is watching this". When
        * that stops being true it stops silently, and this card is now a
        * place people will look instead of the alerts panel. A warning shown
        * twice costs a few pixels; shown in only one of the two places a user
        * checks, it may as well not exist.
        */}
      {server && !watching && armed.length > 0 && (
        <p className="rounded-lg border border-down/30 bg-down/10 px-2 py-1.5 font-sans text-[11px] font-bold text-down">
          Rules are not being watched right now — nothing fires until the service checks in.
        </p>
      )}

      {entries.length > 0 && (
        <Group label="Will open a position">
          {entries.map((rule) => (
            <PendingRow
              key={rule.id}
              rule={rule}
              at={thresholdOf(rule)}
              onCancel={() => cancelRule(rule.id)}
            />
          ))}
        </Group>
      )}

      {exits.length > 0 && (
        <Group label="Will close one">
          {exits.map((rule) => (
            <PendingRow
              key={rule.id}
              rule={rule}
              at={thresholdOf(rule)}
              /* An exit armed alongside an order that has not filled cannot
                 fire and has no threshold to show. Saying so is the whole
                 difference between "inert" and "broken". */
              note={rule.state === "unbound" ? "arms when your order fills" : null}
              onCancel={() => cancelRule(rule.id)}
            />
          ))}
        </Group>
      )}
    </div>
  );
}

function PendingRow({
  rule,
  at,
  note = null,
  onCancel,
}: {
  rule: Rule;
  at: number | null;
  note?: string | null;
  onCancel: () => void;
}) {
  const base = baseSymbol(rule.market);
  return (
    <Row>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-sans text-[12.5px] font-bold text-champagne">
            {rule.side === "buy" ? "Buy" : "Sell"} {amountLabel(rule.amount, base)}
          </div>
          <div className="font-sans text-[10.5px] leading-tight text-ash">
            {triggerLabel(rule)}
            {at !== null && <span className="text-mute"> · {usd(at)}</span>}
            {note && <span className="text-mute"> — {note}</span>}
          </div>
        </div>
        <button
          onClick={onCancel}
          className="shrink-0 rounded-md px-1.5 py-0.5 font-sans text-[10.5px] font-bold text-mute transition-colors hover:bg-slate hover:text-down"
        >
          cancel
        </button>
      </div>
    </Row>
  );
}

/* -------------------------------------------------------------- closed --- */

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
    <div className="flex flex-col">
      {trips.map((t) => {
        const listed = marketByMint(t.mint);
        const symbol = meta[t.mint]?.symbol ?? t.mint;
        const won = t.realisedUsd >= 0;
        return (
          <Row key={`${t.mint}-${t.closedAt}`}>
            <div className="flex items-center gap-2">
              <CoinMark
                symbol={symbol}
                icon={meta[t.mint]?.icon ?? null}
                hue={listed?.hue}
                glyph={listed?.glyph}
                size={24}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-sans text-[13.5px] font-bold text-champagne">
                    {symbol}
                  </span>
                  <span
                    className={`shrink-0 font-sans text-[13.5px] font-bold tabular-nums ${
                      won ? "text-up" : "text-down"
                    }`}
                  >
                    {won ? "+" : "−"}
                    {usd(Math.abs(t.realisedUsd))}
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-sans text-[11.5px] text-mute">
                    {/* How long it was held, and how long ago it ended — the
                        two facts that place a closed trade without a date. */}
                    held {since(t.openedAt, t.closedAt * 1000) || "moments"}
                    {now !== null && ` · ${since(t.closedAt, now)} ago`}
                  </span>
                  <span
                    className={`shrink-0 font-sans text-[11.5px] font-semibold tabular-nums ${
                      won ? "text-up" : "text-down"
                    }`}
                  >
                    {pct(t.returnPct, false)}
                  </span>
                </div>
              </div>
            </div>
            <div className="mt-1 flex items-baseline justify-between gap-2 font-sans text-[10.5px] text-mute">
              <span className="tabular-nums">In {usd(t.investedUsd)}</span>
              <span className="tabular-nums">Out {usd(t.proceedsUsd)}</span>
            </div>
          </Row>
        );
      })}
    </div>
  );
}

/* --------------------------------------------------------------- parts --- */

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-b border-hairline py-2 first:pt-0 last:border-0 last:pb-0">
      {children}
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="font-sans text-[9.5px] font-bold uppercase tracking-[0.11em] text-ash">
        {label}
      </div>
      {children}
    </div>
  );
}

/** Every empty and loading state, one shape. */
function Quiet({ children }: { children: React.ReactNode }) {
  return (
    <p className="py-6 text-center font-sans text-[12px] leading-relaxed text-mute">{children}</p>
  );
}
