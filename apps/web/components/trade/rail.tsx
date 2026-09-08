"use client";

import { useState } from "react";
import { FLOCK_TRADES, LEADERS } from "@/lib/social/mock";
import { Avatar } from "./avatar";
import { Reactions } from "./reactions";

/**
 * The left rail: who is trading right now, and who is winning.
 *
 * Parrot has a third "Watching" tab listing instruments. Dropped — cipher
 * runs one market, so a watchlist of one is a control that does nothing.
 *
 * Everything here is fixture data. See lib/social/mock.ts.
 */

type Tab = "flock" | "top";

export function Rail() {
  const [tab, setTab] = useState<Tab>("flock");
  const [copying, setCopying] = useState<Record<string, boolean>>({});

  return (
    <section className="flex min-h-0 flex-col rounded-2xl border border-line bg-panel">
      <div className="flex gap-1 p-2.5 pb-0">
        {(
          [
            ["flock", "Flock"],
            ["top", "Top"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            aria-selected={tab === k}
            role="tab"
            className={`rounded-full px-3 py-1.5 font-sans text-[11.5px] font-bold transition-colors ${
              tab === k ? "bg-raised text-champagne" : "text-ash hover:text-champagne"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between gap-2 px-3 pb-1.5 pt-2.5">
        <span className="font-sans text-[9.5px] font-bold uppercase tracking-[0.11em] text-ash">
          {tab === "flock" ? "Who's trading right now" : "Best week in your flocks"}
        </span>
        <span className="flex items-center gap-1.5 font-sans text-[10px] font-bold uppercase tracking-[0.09em] text-up">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-up" />
          Live
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-2 pb-2">
        {tab === "flock"
          ? FLOCK_TRADES.map((t) => (
              <article
                key={t.who + t.ago}
                className="flex flex-col gap-2 rounded-xl border border-hairline bg-slate p-2.5 transition-colors hover:border-line"
              >
                <div className="flex items-center gap-2">
                  <Avatar who={t.who} />
                  <div className="min-w-0">
                    <div className="truncate font-sans text-[12.5px] font-bold leading-tight">
                      @{t.who}
                    </div>
                    <div className="font-sans text-[10px] text-ash">{t.ago} ago</div>
                  </div>
                  <button
                    onClick={() => setCopying((c) => ({ ...c, [t.who]: !c[t.who] }))}
                    aria-pressed={Boolean(copying[t.who])}
                    className={`ml-auto shrink-0 rounded-full px-2.5 py-1 font-sans text-[11px] font-extrabold transition-colors ${
                      copying[t.who]
                        ? "bg-raised text-accent shadow-[inset_0_0_0_1.5px_var(--color-accent)]"
                        : "bg-accent text-ink hover:brightness-110"
                    }`}
                  >
                    {copying[t.who] ? "Copying" : "Copy"}
                  </button>
                </div>

                <p className="font-sans text-[12.5px] leading-snug text-ash">
                  <span
                    className={`rounded px-1.5 py-px font-mono text-[10px] ${
                      t.side === "buy" ? "bg-up/15 text-up" : "bg-down/15 text-down"
                    }`}
                  >
                    {t.side.toUpperCase()}
                  </span>{" "}
                  <b className="font-bold text-champagne">
                    ${t.amountUsd.toLocaleString("en-US")}
                  </b>{" "}
                  of <b className="font-bold text-champagne">SOL</b>
                </p>

                <p className="rounded-r-lg border-l-2 border-accent bg-ink px-2.5 py-1.5 font-sans text-[11.5px] leading-relaxed text-ash">
                  {t.squawk}
                </p>

                <Reactions initial={t.reactions} />
              </article>
            ))
          : LEADERS.map((l) => (
              <article
                key={l.who}
                className="flex items-center gap-2.5 rounded-xl border border-hairline bg-slate p-2.5"
              >
                <Avatar who={l.who} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-sans text-[12.5px] font-bold">
                    @{l.who} {l.medal}
                  </div>
                  <div className="font-sans text-[10px] text-ash">{l.wins}</div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-[12.5px] font-bold tabular-nums text-up">
                    {l.pnl}
                  </div>
                  <div className="font-sans text-[10px] text-ash">realised</div>
                </div>
              </article>
            ))}
      </div>
    </section>
  );
}
