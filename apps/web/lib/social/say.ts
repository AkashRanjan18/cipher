"use client";

/**
 * "Use this order": put someone else's sentence into your own prompt bar.
 *
 * THE ONE SOCIAL ACTION ONLY CIPHER HAS. On every other trading feed a trade
 * is a result — a coin, a size, a price — and to act on it you rebuild it by
 * hand in a ticket. On cipher an order IS a sentence, so the feed carries the
 * thing itself: "buy $500 of sol, stop at 10%, target at 30%" can be handed to
 * the next person exactly as it was said.
 *
 * IT FILLS THE BAR AND STOPS. It never sends. A clear sentence executes
 * without a confirmation (CLAUDE.md, 13 Sep 2026), so a button that submitted
 * would be a one-click trade at a stranger's size. The sentence lands in the
 * input, the chart moves to that coin, and the person reads it, changes the
 * amount if they want, and presses Enter themselves.
 *
 * NOT COPY TRADING. Nothing follows the other trader afterwards, nobody is
 * paid, and the fill is at your own price. Copy trading is phase 4.
 *
 * A window event rather than props: the feed sits in the left panel and the
 * profile page is another route entirely, while the bar lives four components
 * away under the chart. The terminal listens to move the market
 * (components/trade/terminal.tsx); Sana listens to take the words
 * (components/trade/sana.tsx).
 */

export const SAY_EVENT = "cipher:say";

export interface Say {
  sentence: string;
  /** The coin the sentence was said about, so "sell half" means the same coin. */
  mint: string;
}

/*
 * The sentence nobody has taken yet.
 *
 * An event alone loses the arrival from another page: the terminal reads the
 * address and speaks on its first effect, and the bar is not always mounted
 * by then, so the words went to a room with nobody in it (found by trying it,
 * 13 Oct 2026). The sentence is kept here until Sana takes it — on the event
 * if it is listening, on mount if it was not.
 */
let waiting: Say | null = null;

export function sayInSana(say: Say): void {
  waiting = say;
  window.dispatchEvent(new CustomEvent<Say>(SAY_EVENT, { detail: say }));
}

/** The sentence waiting for the bar, handed over once. */
export function takeSay(): Say | null {
  const say = waiting;
  waiting = null;
  return say;
}

/** From another page: the terminal reads these on arrival and says it. */
export function sayHref(say: Say): string {
  return `/trade?m=${encodeURIComponent(say.mint)}&say=${encodeURIComponent(say.sentence)}`;
}

/** The event's payload, or null if it is not one of ours. */
export function sayOf(e: Event): Say | null {
  const d = (e as CustomEvent<Partial<Say>>).detail;
  return d && typeof d.sentence === "string" && d.sentence && typeof d.mint === "string" ? (d as Say) : null;
}
