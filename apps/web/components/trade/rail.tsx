"use client";

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

/** Who is trading right now, with what they said about it. */
export function FeedList() {
  return (
    <Empty>
      Nothing here yet. Trades and squawks from the people you follow land here
      once accounts exist.
    </Empty>
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
