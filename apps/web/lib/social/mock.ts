/**
 * The social layer, faked. What is left of it.
 *
 * The feed, the leaderboard, the squawk list and the flocks were all removed:
 * invented people with invented P&L are the one kind of fixture that is
 * actively harmful, because nothing on screen distinguishes them from real
 * ones and a fabricated leaderboard is a claim about other people's returns.
 *
 * Two fixtures remain, both cosmetic and both marked in the UI as
 * placeholders: the chart markers and the ticker tape.
 *
 * It lives in one file, apart from every component, for exactly one reason:
 * when the real thing exists you delete this file and fix the imports. If the
 * fixtures were scattered inline through the components you would find them
 * for months, and some of them would ship.
 *
 * The chart, the price, the candles and YOUR OWN ACCOUNT are real — Binance
 * prices, and a paper ledger in lib/account that charges real fees and
 * refuses to overdraw. Only this file is theatre.
 */

export interface ChartMark {
  /**
   * Where along the loaded history this trade sits, 0 = oldest bar, 1 = newest.
   *
   * This was a count of bars back from the newest, which broke twice over:
   * a mark at -742 simply vanished whenever the feed returned fewer than 742
   * bars, and switching interval moved every mark to a different date because
   * the same bar count is a different span at 1m and at 1d. A fraction lands
   * in the same place in the window whatever the feed sends.
   */
  at: number;
  who: string;
  side: "buy" | "sell";
  amountUsd: number;
  /** In one of your flocks. Drives the "Friends only" overlay. */
  friend: boolean;
  /** Why they did it. Drives the "Thesis" overlay. */
  note: string;
}

/** Trades pinned to the chart. "you" renders in the accent colour. */
/*
 * Spread across the window rather than bunched at the right edge, because the
 * point of putting faces on the chart is that the history looks inhabited.
 */
export const CHART_MARKS: ChartMark[] = [
  { at: 0.16, who: "unipcs", side: "buy", amountUsd: 12_000, friend: false, note: "180 holds" },
  { at: 0.29, who: "kaito", side: "buy", amountUsd: 300, friend: true, note: "sized to not care" },
  { at: 0.41, who: "crayon", side: "sell", amountUsd: 1_400, friend: true, note: "chart looked done" },
  { at: 0.54, who: "mochi", side: "buy", amountUsd: 420, friend: true, note: "deployer is clean" },
  { at: 0.66, who: "ogle", side: "buy", amountUsd: 5_100, friend: false, note: "adding here" },
  { at: 0.78, who: "you", side: "buy", amountUsd: 250, friend: true, note: "" },
  { at: 0.88, who: "vex", side: "sell", amountUsd: 900, friend: true, note: "free ride off" },
  { at: 0.96, who: "kaito", side: "sell", amountUsd: 780, friend: true, note: "taking the rest" },
];

export const STRIP_ITEMS = [
  "🔥 <b>@ogle</b> just 5×'d",
  "🐣 <b>3 friends</b> bought in the last hour",
  "😭 <b>@vex</b> sold the bottom again",
  "🦜 <b>Chart Goblins</b> is up <b class='text-up'>+$182K</b> this week",
  '🧠 <b>@kaito</b>: "size it so you don\'t care"',
  "🚀 <b>SOL</b> is the most-copied market today",
  "🩹 <b>@crayon</b> is down 61% and still posting",
];

const HUES = [
  "var(--color-id-violet)",
  "var(--color-id-cyan)",
  "var(--color-id-lime)",
  "var(--color-id-pink)",
  "var(--color-id-sky)",
  "var(--color-id-coral)",
];

/**
 * A stable colour per handle.
 *
 * Hashed rather than stored so a name that has never been seen still gets a
 * consistent colour, and the same person is the same colour in the rail, on
 * the chart and in the tape.
 */
export function hueOf(handle: string): string {
  let n = 0;
  for (let i = 0; i < handle.length; i++) n = (n * 31 + handle.charCodeAt(i)) >>> 0;
  return HUES[n % HUES.length];
}

export function initials(handle: string): string {
  return handle.replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase();
}
