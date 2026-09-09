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
