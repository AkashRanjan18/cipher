"use client";

import { useState } from "react";
import { FLOCK_TRADES, LEADERS } from "@/lib/social/mock";
import { Avatar } from "./avatar";
import { Reactions } from "./reactions";

/**
 * The social contents of the left panel: the feed, and the leaderboard.
 *
 * This file used to BE the left panel — tabs, header, scroll container and
 * all. fomo's left panel is a four-tab navigator whose primary tab is the
 * market list, so the shell moved to side-panel.tsx and what is left here is
 * the two lists that go inside it.
 *
 * They stayed together in one file because they are the same thing rendered
 * two ways: people, from lib/social/mock.ts. When the social backend exists,
 * both lose their fixtures in the same edit.
 *
 * Everything here is fixture data. See lib/social/mock.ts.
 */

/** Who is trading right now, with what they said about it. */
export function FeedList() {
  const [copying, setCopying] = useState<Record<string, boolean>>({});

  return (
    <div className="flex flex-col gap-1.5 p-2">
      {FLOCK_TRADES.map((t) => (
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
                t.side === "buy" ? "bg-up-soft text-up" : "bg-down-soft text-down"
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
      ))}
    </div>
  );
}

/**
 * The leaderboard.
 *
 * The column is labelled "made others" rather than "P&L", and that is not
 * decoration — ranking leaders on their own gains is what every other
 * platform does, and it selects for the lucky and for people distributing to
 * their followers. The number here is aggregate copier profit. It is the
 * product's second differentiator, so the header has to say so.
 */
export function LeaderList() {
  return (
    <div className="flex flex-col gap-1.5 p-2">
      {LEADERS.map((l, i) => (
        <article
          key={l.who}
          className="flex items-center gap-2.5 rounded-xl border border-hairline bg-slate p-2.5"
        >
          {/* Rank before the face. A leaderboard read top-down needs the
              position visible without counting rows. */}
          <span className="w-4 shrink-0 text-center font-mono text-[11px] font-bold text-mute">
            {l.medal || i + 1}
          </span>
          <Avatar who={l.who} />
          <div className="min-w-0 flex-1">
            <div className="truncate font-sans text-[12.5px] font-bold">@{l.who}</div>
            <div className="font-sans text-[10px] text-ash">{l.wins}</div>
          </div>
          <div className="text-right">
            <div className="font-mono text-[12.5px] font-bold tabular-nums text-up">
              {l.pnl}
            </div>
            <div className="font-sans text-[10px] text-ash">made others</div>
          </div>
        </article>
      ))}
    </div>
  );
}
