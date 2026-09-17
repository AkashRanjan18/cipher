"use client";

import { useMemo, useState } from "react";
import { usePaperAccount } from "@/lib/account/store";
import { allInPrice, positionOf, type Fill } from "@/lib/account/paper";
import { risks, type TokenInfo } from "@/lib/chain/tokens";
import { compact, compactUsd, since, units, usd } from "@/lib/format";
import { useMark } from "./sol-prices";
import { useNow } from "./use-now";

/**
 * THE PANEL UNDER THE CHART: who else holds this, and what you did with it.
 *
 * Built to the table the user supplied — its tab strip, its column rhythm and
 * its two-line numeric stack, where a cell is a bold figure with a quieter one
 * beneath it. The CSS lives in globals.css under `.holders`.
 *
 * THE COLUMNS THAT ARE NOT HERE. The reference's Trader column carries an
 * avatar, a handle and an average hold time; its last column carries a written
 * thesis and a like count, and the strip has "Thesis only" and "Friends only"
 * filters. All of that is fomo's social layer — real people with real
 * positions on a product that has users. cipher has none, so those rows would
 * be invented people with invented P&L, which is the rule that deleted the
 * feed, the flocks and the fabricated leaderboard.
 *
 * What survives is the shape, filled with what is true:
 *
 *   HOLDERS   the token's real concentration, and one Trader row — yours —
 *             when you hold it. The schema is the reference's exactly, so the
 *             day other wallets can be priced they are more rows in this
 *             table and nothing here has to change.
 *   SWAPS     your fills in THIS token, in the same grammar.
 *
 * WHY THERE IS NO WALLET LIST YET. `getTokenLargestAccounts` would give the
 * top twenty addresses, and Solana's public RPC answers that specific method
 * with 429 every time — it is deny-listed for keyless callers, verified
 * against mainnet-beta rather than assumed. Solscan's open endpoint is gone
 * and solana.fm returns 502. Per-wallet P&L needs an indexer on top of that.
 *
 * cipher: a Helius free key covers the address list in two cached calls. The
 * P&L and entry columns stay empty until an indexer can derive them, because
 * a holder's cost basis cannot be inferred from a balance.
 */

type Tab = "holders" | "swaps";

export function TokenTabs({
  token,
  symbol,
  mint,
}: {
  token: TokenInfo | null;
  /** What to call the coin while the lookup is in flight. */
  symbol: string;
  /** Null when a Binance major is open: a chart with no token behind it. */
  mint: string | null;
}) {
  const [tab, setTab] = useState<Tab>("holders");
  const { account } = usePaperAccount();

  /* This token's fills, not the account's. The panel sits under this chart. */
  const swaps = useMemo(
    () => (mint ? account.fills.filter((f) => f.mint === mint) : []),
    [account.fills, mint],
  );

  const name = token?.symbol || symbol;

  return (
    <section className="holders">
      <div className="holders__bar">
        <div className="holders__tabs" role="tablist" aria-label="Token activity">
          <TabButton on={tab === "holders"} onClick={() => setTab("holders")} label="Holders">
            {token && token.holderCount > 0 ? `(${compact(token.holderCount)})` : null}
          </TabButton>
          <TabButton on={tab === "swaps"} onClick={() => setTab("swaps")} label="Swaps">
            {swaps.length > 0 ? `(${swaps.length})` : null}
          </TabButton>
          {/*
            * THESIS IS DISABLED, NOT DELETED, and the reference is why: it
            * greys the tab out too. A thesis is something a user writes about
            * a coin, so the tab is real and its contents are not yet — which
            * is exactly what a disabled control says. A tab that is simply
            * absent says the feature was never considered.
            */}
          <button
            className="tab"
            role="tab"
            aria-selected={false}
            disabled
            title="Arrives with profiles"
          >
            Thesis
          </button>
        </div>
        {/* Where the reference puts its social filters. Those would be two
            controls that do nothing, so this says where the numbers come
            from instead. */}
        <div className="holders__aside">
          {tab === "holders" ? "Concentration from Jupiter" : `Your fills in ${name}`}
        </div>
      </div>

      <div className="holders__scroll">
        {tab === "holders" ? (
          <Holders token={token} symbol={symbol} mint={mint} />
        ) : (
          <Swaps fills={swaps} symbol={name} mint={mint} />
        )}
      </div>
    </section>
  );
}

function TabButton({
  on,
  onClick,
  label,
  children,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button className="tab" role="tab" aria-selected={on} onClick={onClick}>
      {label} {children && <span className="count">{children}</span>}
    </button>
  );
}

/** The reference's caret: one shape, rotated by CSS for the down case. */
function Caret() {
  return (
    <svg className="caret" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true">
      <path d="M5 1.2 9.2 8.4H.8z" />
    </svg>
  );
}

function Clock() {
  return (
    <svg
      className="clock"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

/* -------------------------------------------------------------- holders --- */

function Holders({
  token,
  symbol,
  mint,
}: {
  token: TokenInfo | null;
  symbol: string;
  mint: string | null;
}) {
  const { account, hydrated } = usePaperAccount();
  const mark = useMark(mint);
  const now = useNow(30_000);

  if (!mint) {
    return (
      <p className="empty">
        {symbol} is a chart, not a token — there is no mint behind it and so nobody holds it.
      </p>
    );
  }
  if (!token) return <p className="empty">Looking {symbol} up…</p>;
  /*
   * "You do not hold this" is a CLAIM ABOUT YOUR MONEY, so it waits for the
   * account to arrive. Before hydration the ledger is empty by construction —
   * localStorage has not been read, or Postgres has not answered — and the
   * row rendered a confident denial for anyone holding the coin they were
   * looking at. The same reason the header shows "—" rather than a balance.
   */
  if (!hydrated) return <p className="empty">Reading your account…</p>;

  const top = token.audit?.topHoldersPercentage ?? null;
  const dev = token.audit?.devBalancePercentage ?? null;
  const warnings = risks(token);
  const supply = token.fdv && token.priceUsd > 0 ? token.fdv / token.priceUsd : null;

  /* Your own row. Real, and the only one that can be priced today. */
  const pos = positionOf(account, mint);
  const held = pos.qty > 0;
  /* The shared poll first, the token payload as a fallback: the payload is
     cached for a minute and the poll is five seconds old at worst. */
  const price = mark?.usd ?? token.priceUsd;
  const value = held ? pos.qty * price : 0;
  const invested = held ? pos.qty * pos.costBasis : 0;
  const pnl = value - invested;
  const pnlPct = invested > 0 ? (pnl / invested) * 100 : 0;
  const down = pnl < 0;

  /* The first buy of the position still open — "how long have you been in
     this", which is what the reference's hold time says. */
  const openedAt = held
    ? (account.fills.find((f) => f.mint === mint && f.side === "buy")?.ts ?? null)
    : null;

  return (
    <>
      <table>
        <colgroup>
          <col style={{ width: "28%" }} />
          <col style={{ width: "18%" }} />
          <col style={{ width: "18%" }} />
          <col style={{ width: "18%" }} />
          <col style={{ width: "18%" }} />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">Trader</th>
            <th scope="col" className="num">
              Invested
            </th>
            <th scope="col" className="num">
              Position
            </th>
            <th scope="col" className="num">
              PnL
            </th>
            <th scope="col" className="num">
              Avg. entry
            </th>
          </tr>
        </thead>
        <tbody>
          {held ? (
            <tr>
              <td>
                <div className="trader">
                  {/*
                    * The accent, because accent means "yours" — the one token
                    * in the palette about ownership rather than direction.
                    * The reference hashes a gradient per handle; there is one
                    * trader in this table and it is you.
                    */}
                  <span
                    className="avatar"
                    style={{ background: "var(--color-accent)", color: "var(--color-ink)", fontSize: "12px" }}
                  >
                    You
                  </span>
                  <span>
                    <span className="trader__name">Your position</span>
                    <span className="trader__hold">
                      <Clock />
                      {openedAt && now ? `${since(openedAt, now)} held` : "just opened"}
                    </span>
                  </span>
                </div>
              </td>
              <td className="num">
                <div className="v">{usd(invested)}</div>
              </td>
              <td className="num">
                <div className="v">{usd(value)}</div>
                <div className="s">
                  {units(pos.qty)} {token.symbol || symbol}
                </div>
              </td>
              <td className="num">
                <div className={`v ${down ? "down" : "up"}`}>
                  {down ? "−" : "+"}
                  {usd(Math.abs(pnl))}
                </div>
                <div className={`s ${down ? "down" : "up"}`}>
                  <Caret />
                  {Math.abs(pnlPct).toFixed(2)}%
                </div>
              </td>
              <td className="num">
                <div className="v">{usd(pos.costBasis)}</div>
                {supply !== null && (
                  <div className="s">
                    {compactUsd(pos.costBasis * supply)} <span className="unit">MC</span>
                  </div>
                )}
              </td>
            </tr>
          ) : (
            <tr>
              <td colSpan={5}>
                <p className="empty">
                  You do not hold {token.symbol || symbol}. Buy some and your position appears
                  here, in the same columns everyone else&rsquo;s will.
                </p>
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/*
        * The concentration facts, under the table rather than instead of it.
        * They answer the question the wallet list is usually opened to answer
        * — is this held by a handful of people — and they are real and
        * keyless, which the list is not.
        */}
      <div className="grid grid-cols-2 gap-2 p-[18px] pb-3 sm:grid-cols-4">
        <Stat label="Holders" value={token.holderCount > 0 ? compact(token.holderCount) : "—"} />
        <Stat
          label="Top holders"
          value={top === null ? "—" : `${top.toFixed(1)}%`}
          /* Concentration is the one figure here that is a warning rather
             than a fact, so it is allowed to be red. Half the supply in a few
             wallets is the setup for every exit-liquidity story there is. */
          tone={top === null ? "flat" : top > 50 ? "bad" : top > 25 ? "warn" : "good"}
        />
        <Stat
          label="Dev holds"
          value={dev === null ? "—" : `${dev.toFixed(1)}%`}
          tone={dev === null ? "flat" : dev > 20 ? "bad" : dev > 5 ? "warn" : "good"}
        />
        <Stat
          label="Traders 24h"
          value={token.traders24h === null ? "—" : compact(token.traders24h)}
        />
      </div>

      {top !== null && (
        <div className="flex flex-col gap-1 px-[18px] pb-3">
          <div className="flex items-baseline justify-between text-[13px]">
            <span style={{ color: "var(--h-ink-2)" }}>
              <b className="font-semibold" style={{ color: "var(--h-ink)" }}>
                {top.toFixed(1)}%
              </b>{" "}
              held by the top wallets
            </span>
            <span style={{ color: "var(--h-th)" }}>{(100 - top).toFixed(1)}% everyone else</span>
          </div>
          <div className="flex h-[7px] gap-[5px]">
            <i
              className={`block rounded-full ${top > 50 ? "bg-down" : "bg-accent"}`}
              style={{ flexGrow: top || 1 }}
            />
            <i className="block rounded-full bg-raised" style={{ flexGrow: 100 - top || 1 }} />
          </div>
        </div>
      )}

      {warnings.length > 0 && (
        <ul className="flex flex-col gap-1 px-[18px] pb-3">
          {warnings.map((w) => (
            <li
              key={w}
              className="flex gap-1.5 text-[13px] leading-snug"
              style={{ color: "var(--h-ink-2)" }}
            >
              <span aria-hidden className="shrink-0 text-down">
                !
              </span>
              {w}
            </li>
          ))}
        </ul>
      )}

      {/*
        * The missing rows, named rather than left as a blank space. An empty
        * state that explains itself beats a filled one that lies — and this
        * one doubles as the to-do list.
        */}
      <p className="px-[18px] pb-[18px] text-[12px] leading-snug" style={{ color: "var(--h-th)" }}>
        Other wallets need a Solana RPC key — the public endpoint refuses{" "}
        <code className="font-mono text-[11px]">getTokenLargestAccounts</code> for keyless
        callers. Their P&amp;L and entry need an indexer on top of that, and stay out until they
        can be derived rather than guessed.
      </p>
    </>
  );
}

function Stat({
  label,
  value,
  tone = "flat",
}: {
  label: string;
  value: string;
  tone?: "flat" | "good" | "warn" | "bad";
}) {
  const colour =
    tone === "bad"
      ? "text-down"
      : tone === "warn"
        ? "text-accent"
        : tone === "good"
          ? "text-up"
          : "text-champagne";
  return (
    <div className="rounded-lg border border-line bg-slate px-2.5 py-1.5">
      <div className="text-[11px] font-medium" style={{ color: "var(--h-th)" }}>
        {label}
      </div>
      <div className={`text-[15px] font-semibold tabular-nums ${colour}`}>{value}</div>
    </div>
  );
}

/* ---------------------------------------------------------------- swaps --- */

function Swaps({ fills, symbol, mint }: { fills: Fill[]; symbol: string; mint: string | null }) {
  const { account, hydrated } = usePaperAccount();
  const nowMs = useNow(1000);

  if (!hydrated) return <p className="empty">Reading your account…</p>;
  if (!mint) return <p className="empty">{symbol} is chart-only — there is nothing here to swap.</p>;
  if (fills.length === 0) {
    return (
      <p className="empty">
        You have not traded {symbol} yet. You have {usd(account.usdc)} of paper money — buy some
        on the right, or just tell Sana what you want.
      </p>
    );
  }

  /* Newest first. The ledger appends because it is written forwards; a human
     reads it backwards. */
  const rows = [...fills].reverse();

  return (
    <table>
      <colgroup>
        <col style={{ width: "28%" }} />
        <col style={{ width: "18%" }} />
        <col style={{ width: "18%" }} />
        <col style={{ width: "18%" }} />
        <col style={{ width: "18%" }} />
      </colgroup>
      <thead>
        <tr>
          <th scope="col">Trade</th>
          <th scope="col" className="num">
            Value
          </th>
          <th scope="col" className="num">
            Size
          </th>
          <th scope="col" className="num">
            Price
          </th>
          <th scope="col" className="num">
            Booked
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((f) => {
          const buy = f.side === "buy";
          /* All-in, so size × price is the cash that actually moved. */
          const px = allInPrice(f);
          const cash = f.qty * px;
          const won = f.realisedUsd >= 0;
          return (
            <tr key={f.id}>
              <td>
                <div className="trader">
                  {/*
                    * The side IS the identity of a swap, so it takes the slot
                    * the reference gives a trader's avatar. The same two
                    * colours the candles use — there is nothing to learn.
                    */}
                  <span
                    className="avatar"
                    style={{
                      background: buy ? "var(--color-up-soft)" : "var(--color-down-soft)",
                      color: buy ? "var(--color-up)" : "var(--color-down)",
                      fontSize: "12px",
                    }}
                  >
                    {buy ? "Buy" : "Sell"}
                  </span>
                  <span className="min-w-0">
                    <span className="trader__name">
                      {buy ? "Bought" : "Sold"} {symbol}
                      {/* Placed by Sana rather than by the ticket. */}
                      {f.source === "sana" && <span style={{ color: "var(--h-th)" }}> ✦</span>}
                    </span>
                    <span className="trader__hold">
                      <Clock />
                      {nowMs === null ? "—" : `${since(f.ts, nowMs)} ago`}
                    </span>
                  </span>
                </div>
              </td>
              <td className="num">
                <div className="v">{usd(cash)}</div>
                {f.squawk && <div className="s truncate">{f.squawk}</div>}
              </td>
              <td className="num">
                <div className="v">{units(f.qty)}</div>
                <div className="s">{symbol}</div>
              </td>
              <td className="num">
                <div className="v">{usd(px)}</div>
                <div className="s">fee {usd(f.feeUsd)}</div>
              </td>
              <td className="num">
                {/* Only a sell books anything. A buy shows a dash rather than
                    "$0.00", which reads as a trade that made no money. */}
                {buy ? (
                  <div className="v" style={{ color: "var(--h-th)" }}>
                    —
                  </div>
                ) : (
                  <>
                    <div className={`v ${won ? "up" : "down"}`}>
                      {won ? "+" : "−"}
                      {usd(Math.abs(f.realisedUsd))}
                    </div>
                    <div className={`s ${won ? "up" : "down"}`}>
                      <Caret />
                      {Math.abs(cash > 0 ? (f.realisedUsd / cash) * 100 : 0).toFixed(2)}%
                    </div>
                  </>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
