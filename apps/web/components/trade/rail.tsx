"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { useLiveToken } from "@/lib/auth/use-live-token";
import { fetchFeed } from "@/lib/social/client";
import type { PublicTrade } from "@/lib/social/profiles";
import { TradeRow } from "@/components/social/trade-row";
import { useTokenMeta } from "./use-token-meta";
import { useNow } from "./use-now";

/**
 * The social contents of the left panel: the feed, and the leaderboard.
 *
 * BOTH ARE EMPTY, deliberately. They were rendering invented people with
 * invented P&L — six squawk cards and five leaders with figures like
 * "+$16.7M". Placeholder social proof is the one kind of fixture that is
 * actively harmful to ship: it is indistinguishable from the real thing to
 * anyone looking at the screen, it sets the expectation that the numbers mean
 * something, and on a trading product a fabricated leaderboard is a claim
 * about other people's returns.
 *
 * The empty states say what will fill them, which is more useful than fake
 * rows and is honest about where the product actually is.
 *
 * Both live in one file because they are the same thing rendered two ways:
 * people. When the social backend exists, both get their query in one edit.
 */

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="p-4 text-center font-sans text-[11.5px] leading-relaxed text-ash">
      {children}
    </p>
  );
}

type Scope = "everyone" | "following";

/**
 * The feed: what people on cipher traded, in the words they used.
 *
 * TWO VIEWS, and the order matters.
 *
 *   Everyone    every public trade, newest first. The default, and open to a
 *               visitor who has not signed in. It is how you find someone
 *               worth following: until 13 Oct 2026 the only feed was
 *               Following, which is empty on day one, and the only way to
 *               find a trader was to already know their handle.
 *   Following   only the people you chose.
 *
 * Neither is ranked — by time, never by profit (see everyoneFeed). Empty
 * means empty and says which kind: nothing here is padded.
 *
 * Each row's sentence can be taken into your own bar with "Use this order",
 * and each fill links to its receipt on devnet once it has one — both live in
 * components/social/trade-row.tsx.
 */
export function FeedList() {
  const { authenticated } = usePrivy();
  const liveToken = useLiveToken();
  const router = useRouter();
  const now = useNow(30_000);
  const [scope, setScope] = useState<Scope>("everyone");
  /* Keyed by scope, so switching shows that view's own rows (or its own
     "Loading…"), never the other view's rows under the wrong heading. */
  const [loaded, setLoaded] = useState<Partial<Record<Scope, PublicTrade[]>>>({});
  const [go, setGo] = useState("");
  const trades = loaded[scope] ?? null;
  const meta = useTokenMeta(trades?.map((t) => t.mint) ?? []);
  const locked = scope === "following" && !authenticated;

  useEffect(() => {
    if (locked) return;
    let alive = true;
    const pull = () =>
      void liveToken()
        .then((token) => fetchFeed(token, scope))
        .then((t) => {
          if (alive && t) setLoaded((was) => ({ ...was, [scope]: t }));
        });
    pull();
    const id = window.setInterval(pull, 20_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [authenticated, liveToken, scope, locked]);

  return (
    <div className="flex flex-col">
      <div className="flex gap-1.5 border-b border-hairline p-2">
        {(
          [
            ["everyone", "Everyone"],
            ["following", "Following"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setScope(k)}
            aria-pressed={scope === k}
            className={`rounded-lg border px-2.5 py-1 font-sans text-[11.5px] font-semibold transition-colors ${
              scope === k ? "border-line bg-slate text-champagne" : "border-transparent text-ash hover:text-champagne"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const h = go.trim().replace(/^@/, "").toLowerCase();
          if (h) router.push(`/u/${h}`);
        }}
        className="flex gap-1.5 border-b border-hairline p-2"
      >
        <input
          id="feed-find"
          value={go}
          onChange={(e) => setGo(e.target.value)}
          placeholder="Find a trader — @handle"
          className="min-w-0 flex-1 rounded-lg border border-line bg-slate px-2.5 py-1.5 font-sans text-[12px] text-champagne outline-none placeholder:text-mute focus:border-action"
        />
        <button className="rounded-lg border border-line px-2.5 font-sans text-[11px] font-semibold text-ash hover:text-champagne">
          Go
        </button>
      </form>
      {locked ? (
        <Empty>Sign in to follow traders. Their trades land here, with the sentence behind each one.</Empty>
      ) : trades === null ? (
        <Empty>Loading…</Empty>
      ) : trades.length === 0 ? (
        scope === "everyone" ? (
          <Empty>
            No public trades yet. When there are, every trade shows here with the sentence that
            placed it.
          </Empty>
        ) : (
          <Empty>
            Nothing yet. Open <b>Everyone</b>, pick a trader, and follow them from their profile.
          </Empty>
        )
      ) : (
        trades.map((t) => <TradeRow key={t.id} t={t} meta={meta[t.mint]} now={now} />)
      )}
    </div>
  );
}

/**
 * The leaderboard.
 *
 * When this fills, it ranks on aggregate COPIER profit — how much a leader
 * made other people — not on the leader's own P&L. That is the second
 * differentiator, and it is the reason this list cannot be populated early:
 * the number does not exist until copy trading does.
 */
export function LeaderList() {
  return (
    <Empty>
      No leaders yet. This ranks on how much a trader made <b>other people</b>,
      not on their own P&amp;L — so it fills once copy trading is live.
    </Empty>
  );
}
