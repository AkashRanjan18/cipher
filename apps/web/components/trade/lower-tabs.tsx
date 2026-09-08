"use client";

import { useState } from "react";
import { SQUAWKS, FLOCKS, hueOf } from "@/lib/social/mock";
import { usePaperAccount } from "@/lib/account/store";
import { allInPrice } from "@/lib/account/paper";
import { usd, since } from "@/lib/format";
import { Avatar } from "./avatar";
import { Reactions } from "./reactions";

/**
 * The panel under the chart: talk, tape, groups, your own trades.
 *
 * Squawks and Flocks are fixtures. "My trades" is not — it is the real fill
 * history of the paper account, in the order it happened, priced all-in so
 * size times price is the cash that actually moved.
 *
 * Parrot's Tape tab is omitted rather than faked. A fabricated tape sitting
 * under a real chart is the one place invented data would be mistaken for
 * market data. It returns when the aggTrade socket lands, which is a small
 * job on top of the Binance adapter already in lib/market.
 */

type Tab = "squawks" | "flocks" | "mine";

export function LowerTabs() {
  const [tab, setTab] = useState<Tab>("squawks");

  return (
    <div className="flex min-h-0 flex-col border-t border-hairline">
      <div className="flex gap-1 px-2.5 pb-1.5 pt-2.5" role="tablist">
        {(
          [
            ["squawks", "Squawks"],
            ["flocks", "Flocks"],
            ["mine", "My trades"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`rounded-full px-3 py-1.5 font-sans text-[11.5px] font-bold transition-colors ${
              tab === k ? "bg-raised text-champagne" : "text-ash hover:text-champagne"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-2.5 pb-2.5">
        {tab === "squawks" &&
          SQUAWKS.map((s) => (
            <article
              key={s.who + s.ago}
              className="flex flex-col gap-2 rounded-xl border border-hairline bg-slate p-2.5"
            >
              <div className="flex items-center gap-2">
                <Avatar who={s.who} />
                <div>
                  <div className="font-sans text-[12.5px] font-bold leading-tight">
                    @{s.who}
                  </div>
                  <div className="font-sans text-[10px] text-ash">{s.ago} ago</div>
                </div>
              </div>
              <p
                className="rounded-r-lg border-l-2 bg-ink px-2.5 py-1.5 font-sans text-[11.5px] leading-relaxed text-ash"
                style={{ borderLeftColor: hueOf(s.who) }}
              >
                {s.text}
              </p>
              <Reactions initial={s.reactions} />
            </article>
          ))}

        {tab === "flocks" &&
          FLOCKS.map((f) => (
            <article
              key={f.name}
              className="flex items-center gap-3 rounded-xl border border-hairline bg-slate px-3 py-2.5"
            >
              <span
                className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-base"
                style={{ background: hueOf(f.name) }}
              >
                {f.emoji}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 font-sans text-[13.5px] font-bold">
                  {f.name}
                  {f.youAreIn && (
                    <span className="rounded-full bg-accent/15 px-1.5 py-px font-mono text-[8.5px] text-accent">
                      you&rsquo;re in
                    </span>
                  )}
                </div>
                <div className="font-sans text-[10px] text-ash">
                  {f.members} members · 7-day P&amp;L
                </div>
              </div>
              <div
                className={`font-mono text-[13px] font-bold tabular-nums ${
                  f.weekPnl.startsWith("+") ? "text-up" : "text-down"
                }`}
              >
                {f.weekPnl}
              </div>
            </article>
          ))}

        {tab === "mine" && <MyTrades />}
      </div>
    </div>
  );
}

function MyTrades() {
  const { account, hydrated } = usePaperAccount();

  if (!hydrated) {
    return <p className="p-4 text-center font-sans text-xs text-ash">Reading your account…</p>;
  }

  if (account.fills.length === 0) {
    return (
      <p className="p-4 text-center font-sans text-xs leading-relaxed text-ash">
        No trades yet. You have {usd(account.usdc)} of paper money — buy something on the right,
        or just tell Polly what you want.
      </p>
    );
  }

  /* Newest first. The engine appends, because a ledger is written forwards;
     a human reads it backwards. */
  const fills = [...account.fills].reverse();
  const nowMs = Date.now();

  return (
    <table className="w-full border-collapse font-sans text-[11.5px]">
      <thead>
        <tr>
          {["When", "Side", "Size", "Price", "Your squawk", "Booked"].map((h, i) => (
            <th
              key={h}
              className={`bg-panel px-2.5 py-1.5 font-sans text-[9px] font-bold uppercase tracking-[0.1em] text-ash ${
                i >= 2 && i !== 4 ? "text-right" : "text-left"
              }`}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {fills.map((f) => (
          <tr key={f.id}>
            <td className="whitespace-nowrap border-t border-hairline px-2.5 py-1.5 text-ash">
              {since(f.ts, nowMs)} ago
            </td>
            <td
              className={`border-t border-hairline px-2.5 py-1.5 ${
                f.side === "buy" ? "text-up" : "text-down"
              }`}
            >
              {f.side === "buy" ? "Buy" : "Sell"}
              {f.source === "polly" && <span className="ml-1 text-ash">🦜</span>}
            </td>
            <td className="border-t border-hairline px-2.5 py-1.5 text-right font-mono tabular-nums">
              {f.qty.toFixed(4)} SOL
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
