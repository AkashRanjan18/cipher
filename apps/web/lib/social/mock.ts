/**
 * The social layer, faked.
 *
 * EVERY name, squawk, reaction and P&L in this file is invented. There is no
 * social backend yet — no accounts, no follows, no flocks, no copy engine.
 *
 * It lives in one file, apart from every component, for exactly one reason:
 * when the real thing exists you delete this file and fix the imports. If the
 * fixtures were scattered inline through the components you would find them
 * for months, and some of them would ship.
 *
 * The chart, the price and the candles are REAL — Binance SOL/USDT. Only this
 * file is theatre, and the UI marks it as such.
 */

export interface FlockTrade {
  who: string;
  side: "buy" | "sell";
  amountUsd: number;
  ago: string;
  squawk: string;
  reactions: Record<string, number>;
}

export interface Squawk {
  who: string;
  ago: string;
  text: string;
  reactions: Record<string, number>;
}

export interface Flock {
  name: string;
  emoji: string;
  members: number;
  weekPnl: string;
  youAreIn: boolean;
}

export interface ChartMark {
  /** Bars back from the newest. Negative. */
  offset: number;
  who: string;
  side: "buy" | "sell";
  amountUsd: number;
}

export const FLOCK_TRADES: FlockTrade[] = [
  { who: "mochi", side: "buy", amountUsd: 420, ago: "12s",
    squawk: "beak wet. deployer wallet is clean, i checked twice.",
    reactions: { "🔥": 14, "😂": 2, "🧠": 6 } },
  { who: "vex", side: "sell", amountUsd: 1900, ago: "1m",
    squawk: "taking the free ride off the table, letting the rest run.",
    reactions: { "🫡": 9, "😭": 3 } },
  { who: "unipcs", side: "buy", amountUsd: 12000, ago: "4m",
    squawk: "nothing clever. just think 180 holds.",
    reactions: { "🔥": 61, "🧠": 22 } },
  { who: "crayon", side: "buy", amountUsd: 80, ago: "6m",
    squawk: "entirely because of the chart. this is not advice.",
    reactions: { "😂": 38, "🤡": 11 } },
  { who: "ogle", side: "sell", amountUsd: 5400, ago: "9m",
    squawk: "looks tired up here. out flat, no hard feelings.",
    reactions: { "🫡": 17 } },
  { who: "kaito", side: "buy", amountUsd: 300, ago: "21m",
    squawk: "sized so i genuinely do not care if it goes to zero.",
    reactions: { "🧠": 44, "🔥": 7 } },
];

export const SQUAWKS: Squawk[] = [
  { who: "mochi", ago: "12s", text: "beak wet. deployer wallet is clean, i checked twice.", reactions: { "🔥": 14, "🧠": 6 } },
  { who: "kaito", ago: "21m", text: "sized so i genuinely do not care if it goes to zero. that is the whole plan.", reactions: { "🧠": 44, "🔥": 7 } },
  { who: "crayon", ago: "26m", text: "entirely because of the chart. this is not advice and never was.", reactions: { "😂": 38, "🤡": 11 } },
  { who: "vex", ago: "44m", text: "reminder that a major can still gap. i am in, but small.", reactions: { "🫡": 23, "🧠": 12 } },
];

export const FLOCKS: Flock[] = [
  { name: "Chart Goblins", emoji: "👹", members: 24, weekPnl: "+$182K", youAreIn: true },
  { name: "Slow Money", emoji: "🐢", members: 11, weekPnl: "+$41K", youAreIn: true },
  { name: "The Night Shift", emoji: "🌙", members: 63, weekPnl: "+$1.2M", youAreIn: false },
  { name: "Rugged Survivors", emoji: "🩹", members: 308, weekPnl: "−$96K", youAreIn: false },
];

export const LEADERS: { who: string; pnl: string; wins: string; medal: string }[] = [
  { who: "unipcs", pnl: "+$16.7M", wins: "226 wins", medal: "🥇" },
  { who: "crayon", pnl: "+$8.4M", wins: "77 wins", medal: "🥈" },
  { who: "salem", pnl: "+$6.0M", wins: "11 wins", medal: "🥉" },
  { who: "ogle", pnl: "+$5.6M", wins: "64 wins", medal: "" },
  { who: "mochi", pnl: "+$2.1M", wins: "38 wins", medal: "" },
];

/** Trades pinned to the chart. "you" renders in the accent colour. */
export const CHART_MARKS: ChartMark[] = [
  { offset: -58, who: "mochi", side: "buy", amountUsd: 420 },
  { offset: -41, who: "kaito", side: "buy", amountUsd: 300 },
  { offset: -24, who: "you", side: "buy", amountUsd: 250 },
  { offset: -11, who: "vex", side: "sell", amountUsd: 900 },
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

/** Your open position. Also invented. */
export const POSITION = { sizeSol: 9.4, entryUsd: 171.2 };

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
