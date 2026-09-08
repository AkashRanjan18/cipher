"use client";

import { useState } from "react";
import { SQUAWKS, FLOCKS, POSITION, hueOf } from "@/lib/social/mock";
import { usd, pct } from "@/lib/format";
import { Avatar } from "./avatar";
import { Reactions } from "./reactions";

/**
 * The panel under the chart: talk, tape, groups, your own trades.
 *
 * Squawks and Flocks are fixtures. "My trades" reads the fake position but
 * marks it live against the REAL price, so the P&L moves with the market —
 * which is the point of putting it here rather than in a static card.
 *
 * Parrot's Tape tab is omitted rather than faked. A fabricated tape sitting
 * under a real chart is the one place invented data would be mistaken for
 * market data. It returns when the aggTrade socket lands, which is a small
 * job on top of the Binance adapter already in lib/market.
 */

type Tab = "squawks" | "flocks" | "mine";

export function LowerTabs({ price }: { price: number | undefined }) {
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

        {tab === "mine" && <MyTrades price={price} />}
      </div>
    </div>
  );
}

function MyTrades({ price }: { price: number | undefined }) {
  if (price === undefined) {
    return <p className="p-4 text-center font-sans text-xs text-ash">Waiting for a price…</p>;
  }

  const { sizeSol, entryUsd } = POSITION;
  const pnl = (price - entryUsd) * sizeSol;
  const pnlPct = ((price - entryUsd) / entryUsd) * 100;

  return (
    <table className="w-full border-collapse font-sans text-[11.5px]">
      <thead>
        <tr>
          {["When", "Side", "Size", "Price", "Your squawk", "P&L"].map((h, i) => (
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
        <tr>
          <td className="whitespace-nowrap border-t border-hairline px-2.5 py-1.5 text-ash">
            2h ago
          </td>
          <td className="border-t border-hairline px-2.5 py-1.5 text-up">Buy</td>
          <td className="border-t border-hairline px-2.5 py-1.5 text-right font-mono tabular-nums">
            {sizeSol} SOL
          </td>
          <td className="border-t border-hairline px-2.5 py-1.5 text-right font-mono tabular-nums">
            {usd(entryUsd)}
          </td>
          <td className="border-t border-hairline px-2.5 py-1.5 text-ash">
            Sized for a full loss. Out at 3× or if it breaks 150.
          </td>
          <td
            className={`whitespace-nowrap border-t border-hairline px-2.5 py-1.5 text-right font-mono font-bold tabular-nums ${
              pnl >= 0 ? "text-up" : "text-down"
            }`}
          >
            {pnl >= 0 ? "+" : "−"}${Math.abs(pnl).toFixed(2)} ({pct(pnlPct, false)})
          </td>
        </tr>
      </tbody>
    </table>
  );
}
