"use client";

import { useMemo, useState } from "react";
import { usePaperAccount } from "@/lib/account/store";
import { allInPrice } from "@/lib/account/paper";
import { risks, type TokenInfo } from "@/lib/chain/tokens";
import { compact, since, units, usd } from "@/lib/format";
import { useNow } from "./use-now";

/**
 * THE PANEL UNDER THE CHART: who else holds this, and what you did with it.
 *
 * Was "My trades" — one unlabelled list of every fill in the account, on a
 * panel sitting under a chart of one particular token. The two did not agree:
 * you looked at PAID and read your SOL trades.
 *
 * Both tabs are now about the coin on screen, which is what the panel's
 * position already promised.
 *
 *   HOLDERS   how the supply is spread, from Jupiter's token payload
 *   SWAPS     your own fills in THIS token, priced all-in
 *
 * WHAT IS NOT HERE, AND WHY IT IS NOT FAKED. fomo's holders tab is a table of
 * named traders with a position, a P&L, an average entry and a written thesis.
 * Two separate things stand in the way, and neither is a styling problem:
 *
 *   THE NAMES. Those are fomo's own users. cipher has no social layer yet, so
 *   a table of traders here would be invented people — the exact thing the
 *   design rule in CLAUDE.md forbids, and the reason the feed, the flocks and
 *   the fabricated leaderboard were all deleted.
 *
 *   THE NUMBERS. A wallet's P&L and average entry come from replaying its
 *   whole trade history, which needs an indexer. `getTokenLargestAccounts`
 *   would at least give the top twenty ADDRESSES, but Solana's public RPC
 *   answers that specific method with 429 every time — it is on the
 *   deny-list for keyless callers, verified against mainnet-beta rather than
 *   assumed. Solscan's open endpoint is gone and solana.fm returns 502.
 *
 * So this shows the concentration facts that ARE real and keyless, and says
 * plainly what is missing. A token where the top holders own 71% is the
 * question that table is usually being read to answer anyway.
 *
 * cipher: the per-wallet list lands the day an RPC key exists. Helius's free
 * tier covers getTokenLargestAccounts plus a getMultipleAccounts to turn
 * token accounts into owners — two cached calls per token. P&L per wallet
 * stays out until there is an indexer to derive it honestly.
 */

type Tab = "holders" | "swaps";

export function TokenTabs({ token, symbol, mint }: {
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-hairline px-2.5 py-1.5">
        <TabButton on={tab === "holders"} onClick={() => setTab("holders")}>
          Holders
          {token && token.holderCount > 0 && (
            <span className="ml-1.5 font-normal text-mute">{compact(token.holderCount)}</span>
          )}
        </TabButton>
        <TabButton on={tab === "swaps"} onClick={() => setTab("swaps")}>
          Swaps
          {swaps.length > 0 && (
            <span className="ml-1.5 font-normal text-mute">{swaps.length}</span>
          )}
        </TabButton>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "holders" ? (
          <Holders token={token} symbol={symbol} mint={mint} />
        ) : (
          <Swaps fills={swaps} symbol={token?.symbol || symbol} mint={mint} />
        )}
      </div>
    </div>
  );
}

function TabButton({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      role="tab"
      aria-selected={on}
      onClick={onClick}
      className={`rounded-lg px-2.5 py-1 font-sans text-[12px] font-bold transition-colors ${
        on ? "bg-raised text-champagne" : "text-mute hover:text-ash"
      }`}
    >
      {children}
    </button>
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
  if (!mint) {
    return (
      <Quiet>
        {symbol} is a chart, not a token — there is no mint behind it and so nobody holds it.
      </Quiet>
    );
  }
  if (!token) return <Quiet>Looking {symbol} up…</Quiet>;

  const top = token.audit?.topHoldersPercentage ?? null;
  const dev = token.audit?.devBalancePercentage ?? null;
  const warnings = risks(token);

  return (
    <div className="flex flex-col gap-2.5 p-2.5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Holders" value={token.holderCount > 0 ? compact(token.holderCount) : "—"} />
        <Stat
          label="Top holders"
          value={top === null ? "—" : `${top.toFixed(1)}%`}
          /* Concentration is the one number here that is a warning rather than
             a fact, so it is allowed to be red. Half the supply in a handful
             of wallets is the setup for every exit-liquidity story there is. */
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

      {/*
        * ONE BAR: what the top holders own against what everyone else does.
        *
        * The percentage above is the same information, and the bar is still
        * worth the eight pixels — "71%" has to be compared against a number
        * you are carrying in your head, and a bar that is two-thirds full has
        * already made the comparison.
        */}
      {top !== null && (
        <div className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between font-sans text-[11px]">
            <span className="text-ash">
              <b className="font-bold text-champagne">{top.toFixed(1)}%</b> held by the top wallets
            </span>
            <span className="text-mute">{(100 - top).toFixed(1)}% everyone else</span>
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
        <ul className="flex flex-col gap-1">
          {warnings.map((w) => (
            <li key={w} className="flex gap-1.5 font-sans text-[11.5px] leading-snug text-ash">
              <span aria-hidden className="shrink-0 text-down">
                !
              </span>
              {w}
            </li>
          ))}
        </ul>
      )}

      {/*
        * The missing table, named rather than left as a blank space.
        *
        * An empty state that explains itself beats a filled one that lies —
        * and this one is also the to-do list: it says exactly what has to
        * exist before the row of traders can appear.
        */}
      <p className="border-t border-hairline pt-2 font-sans text-[10.5px] leading-snug text-mute">
        Wallet-by-wallet holdings need a Solana RPC key — the public endpoint refuses
        <code className="mx-1 font-mono text-[10px] text-ash">getTokenLargestAccounts</code>
        for keyless callers. Per-wallet P&amp;L needs an indexer on top of that, and it is not
        shown until it can be derived rather than guessed.
      </p>
    </div>
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
      <div className="font-sans text-[9.5px] font-bold uppercase tracking-[0.1em] text-ash">
        {label}
      </div>
      <div className={`font-sans text-[15px] font-bold tabular-nums ${colour}`}>{value}</div>
    </div>
  );
}

/* ---------------------------------------------------------------- swaps --- */

function Swaps({
  fills,
  symbol,
  mint,
}: {
  fills: import("@/lib/account/paper").Fill[];
  symbol: string;
  mint: string | null;
}) {
  const { account, hydrated } = usePaperAccount();
  const nowMs = useNow(1000);

  if (!hydrated) return <Quiet>Reading your account…</Quiet>;
  if (!mint) return <Quiet>{symbol} is chart-only — there is nothing here to swap.</Quiet>;
  if (fills.length === 0) {
    return (
      <Quiet>
        You have not traded {symbol} yet. You have {usd(account.usdc)} of paper money — buy some
        on the right, or just tell Sana what you want.
      </Quiet>
    );
  }

  /* Newest first. The ledger appends because it is written forwards; a human
     reads it backwards. */
  const rows = [...fills].reverse();

  return (
    <table className="w-full border-collapse font-sans text-[11.5px]">
      <thead>
        <tr>
          {["When", "Side", "Size", "Price", "Your squawk", "Booked"].map((h, i) => (
            <th
              key={h}
              className={`sticky top-0 bg-panel px-2.5 py-1.5 font-sans text-[9px] font-bold uppercase tracking-[0.1em] text-ash ${
                i >= 2 && i !== 4 ? "text-right" : "text-left"
              }`}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((f) => (
          <tr key={f.id}>
            <td className="whitespace-nowrap border-t border-hairline px-2.5 py-1.5 text-ash">
              {nowMs === null ? "—" : `${since(f.ts, nowMs)} ago`}
            </td>
            <td
              className={`border-t border-hairline px-2.5 py-1.5 ${
                f.side === "buy" ? "text-up" : "text-down"
              }`}
            >
              {f.side === "buy" ? "Buy" : "Sell"}
              {f.source === "sana" && <span className="ml-1 text-ash">✦</span>}
            </td>
            {/*
              * THE TOKEN'S OWN SYMBOL, not "SOL".
              *
              * This column was hardcoded to SOL from when the ledger held one
              * asset, so every row of every coin claimed to be Solana. Four
              * decimals also went: a memecoin position is millions of units
              * and "19188444.5217 PAID" is not a number anyone reads.
              */}
            <td className="border-t border-hairline px-2.5 py-1.5 text-right font-mono tabular-nums">
              {units(f.qty)} {symbol}
            </td>
            {/* All-in, so size × price is the cash that actually moved. */}
            <td className="border-t border-hairline px-2.5 py-1.5 text-right font-mono tabular-nums">
              {usd(allInPrice(f))}
            </td>
            <td className="border-t border-hairline px-2.5 py-1.5 text-ash">
              {f.squawk || <span className="opacity-50">—</span>}
            </td>
            {/* Only a sell books anything. A buy shows nothing rather than
                "$0.00", which would read as a trade that made no money. */}
            <td
              className={`whitespace-nowrap border-t border-hairline px-2.5 py-1.5 text-right font-mono font-bold tabular-nums ${
                f.side === "buy" ? "text-ash" : f.realisedUsd >= 0 ? "text-up" : "text-down"
              }`}
            >
              {f.side === "buy"
                ? "—"
                : `${f.realisedUsd >= 0 ? "+" : "−"}${usd(Math.abs(f.realisedUsd))}`}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Quiet({ children }: { children: React.ReactNode }) {
  return (
    <p className="p-4 text-center font-sans text-[12px] leading-relaxed text-mute">{children}</p>
  );
}
