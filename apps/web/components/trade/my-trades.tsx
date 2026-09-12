"use client";

import { usePaperAccount } from "@/lib/account/store";
import { allInPrice } from "@/lib/account/paper";
import { usd, since } from "@/lib/format";

/**
 * The panel under the chart: your own fills.
 *
 * Was lower-tabs.tsx — three tabs, of which Squawks and Flocks were invented
 * people saying invented things. They are gone. This is the only tab that was
 * ever real: the fill history of the paper account, in the order it happened,
 * priced ALL-IN so size times price is the cash that actually moved.
 *
 * No tab row any more. One tab is not a choice, and a tablist with a single
 * item is a control that does nothing — the same reason the market switcher
 * was left out while cipher ran one market. It is a labelled panel now.
 *
 * Parrot's Tape tab is still omitted rather than faked. A fabricated tape
 * sitting under a real chart is the one place invented data would be mistaken
 * for market data. It returns when the aggTrade socket lands, which is a small
 * job on top of the Binance adapter already in lib/market.
 */
export function MyTrades() {
  const { account, hydrated } = usePaperAccount();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-baseline gap-2 px-2.5 py-1.5">
        <h2 className="font-sans text-[10px] font-bold uppercase tracking-[0.11em] text-ash">
          My trades
        </h2>
        {hydrated && account.fills.length > 0 && (
          <span className="font-mono text-[10px] text-mute">
            {account.fills.length}
          </span>
        )}
      </div>

      {/* The column now ends above the prompt bar (see terminal.tsx), so the
          old pb-24 compensating for the overlap is gone. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-2.5">
        <Fills />
      </div>
    </div>
  );
}

function Fills() {
  const { account, hydrated } = usePaperAccount();

  if (!hydrated) {
    return <p className="p-4 text-center font-sans text-xs text-ash">Reading your account…</p>;
  }

  if (account.fills.length === 0) {
    return (
      <p className="p-4 text-center font-sans text-xs leading-relaxed text-ash">
        No trades yet. You have {usd(account.usdc)} of paper money — buy something on the right,
        or just tell Sana what you want.
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
              {f.source === "sana" && <span className="ml-1 text-ash">✦</span>}
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
