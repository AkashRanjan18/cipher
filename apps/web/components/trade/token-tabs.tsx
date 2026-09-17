"use client";

import { usePaperAccount } from "@/lib/account/store";
import { positionOf } from "@/lib/account/paper";
import type { TokenInfo } from "@/lib/chain/tokens";
import { compact, compactUsd, since, units, usd } from "@/lib/format";
import { useMark } from "./sol-prices";
import { useNow } from "./use-now";

/**
 * THE PANEL UNDER THE CHART: who holds this coin.
 *
 * Built to the table the user supplied — its bar, its column rhythm and its
 * two-line numeric stack, where a cell is a bold figure with a quieter one
 * beneath it. The CSS lives in globals.css under `.holders`.
 *
 * ONE TABLE, NO TABS. It briefly carried Holders, Swaps and a disabled Thesis
 * alongside the reference's; the user removed the last two. Which means the
 * fills that used to live under this chart now appear nowhere — the Positions
 * card's Closed tab has the round trips and the alerts panel has the rules,
 * but a single fill has no home on screen. Worth knowing; not a bug.
 *
 * THE COLUMNS THAT ARE NOT HERE. The reference's Trader column carries an
 * avatar and a handle; its last column carries a written thesis and a like
 * count, and its bar has "Thesis only" and "Friends only" filters. All of
 * that is fomo's social layer — real people with real positions on a product
 * that has users. cipher has none, so those rows would be invented people
 * with invented P&L, which is the rule that deleted the feed, the flocks and
 * the fabricated leaderboard.
 *
 * So the schema is the reference's exactly and holds the one row that is
 * true: yours. The day other wallets can be priced they are more rows in this
 * table and nothing here has to change.
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
  return (
    <section className="holders">
      <div className="holders__bar">
        {/*
         * A HEADING, NOT A TABLIST.
         *
         * Swaps and Thesis are gone on the user's instruction, and one tab is
         * not a choice — the rule in CLAUDE.md that removed the single-item
         * tab row from the panel this replaced, and that removed the
         * Price/MCap control's first version. A tablist with one item is a
         * control that cannot be operated; a label is honest about being a
         * label.
         *
         * The count stays on it, because "Holders 3.82M" is the one fact
         * about this table that is true before you have read a row of it.
         */}
        <h2 className="tab" aria-current="true">
          Holders{" "}
          {token && token.holderCount > 0 && (
            <span className="count">({compact(token.holderCount)})</span>
          )}
        </h2>
        {/* Where the reference puts its social filters. Those would be two
            controls that do nothing, so this says where the number comes
            from instead. */}
        <div className="holders__aside">Concentration from Jupiter</div>
      </div>

      <div className="holders__scroll">
        <Holders token={token} symbol={symbol} mint={mint} />
      </div>
    </section>
  );
}

/** The reference's caret: one shape, rotated by CSS for the down case. */
function Caret() {
  return (
    <svg
      className="caret"
      viewBox="0 0 10 10"
      fill="currentColor"
      aria-hidden="true"
    >
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
        {symbol} is a chart, not a token — there is no mint behind it and so
        nobody holds it.
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

  const supply =
    token.fdv && token.priceUsd > 0 ? token.fdv / token.priceUsd : null;

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
    ? (account.fills.find((f) => f.mint === mint && f.side === "buy")?.ts ??
      null)
    : null;

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
                  style={{
                    background: "var(--color-accent)",
                    color: "var(--color-ink)",
                    fontSize: "12px",
                  }}
                >
                  You
                </span>
                <span>
                  <span className="trader__name">Your position</span>
                  <span className="trader__hold">
                    <Clock />
                    {openedAt && now
                      ? `${since(openedAt, now)} held`
                      : "just opened"}
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
                  {compactUsd(pos.costBasis * supply)}{" "}
                  <span className="unit">MC</span>
                </div>
              )}
            </td>
          </tr>
        ) : (
          <tr>
            <td colSpan={5}>
              <p className="empty">
                You do not hold {token.symbol || symbol}. Buy some and your
                position appears here, in the same columns everyone else&rsquo;s
                will.
              </p>
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
