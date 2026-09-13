/**
 * The tradable universe, on Solana.
 *
 * WHY THIS EXISTS ALONGSIDE lib/market/markets.ts, which is Binance pairs.
 *
 * The old list is what the CHART draws: BTC, ETH, XRP and the rest, from a
 * centralised exchange with clean OHLC history. It is a fine source for a
 * picture. It is the wrong source for a trigger, and the reason is not
 * latency — it is that a rule firing on Binance's SOL/USDT order book would
 * execute against a Raydium pool. Two different markets, with a basis between
 * them that is invisible to the user and unbounded during a move. For a
 * memecoin there is no Binance price at all.
 *
 * A TRIGGER MUST WATCH THE VENUE IT TRADES ON. That is the whole point of this
 * file: every mint here is priced from Solana liquidity, through the same
 * routes a swap would take.
 *
 * Every mint below was RESOLVED, not typed. Each came from Jupiter's verified
 * list filtered to over a thousand holders and six figures of liquidity —
 * because pasting a mint from memory is exactly the mistake lib/chain/tokens.ts
 * exists to prevent, and it would be absurd to make it here.
 */

import { marketOf } from "../market/markets.ts";

export interface SolanaMarket {
  mint: string;
  /** What the UI calls it. */
  symbol: string;
  name: string;
  decimals: number;
  /** A colour to recognise a row by, matching the Binance list's convention. */
  hue: string;
  glyph: string;
  /**
   * The Binance pair whose candles stand in for a chart, when one exists.
   *
   * Null for anything Binance does not list, which is most of the interesting
   * ones. Those have no chart yet — candles for a Solana token have to be
   * built from swap history, which is a separate piece of work and is not
   * pretended at here.
   */
  chartPair: string | null;
}

export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export const SOLANA_MARKETS: SolanaMarket[] = [
  {
    mint: SOL_MINT,
    symbol: "SOL",
    name: "Solana",
    decimals: 9,
    hue: "#14f195",
    glyph: "◎",
    chartPair: "SOLUSDT",
  },
  {
    mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    symbol: "BONK",
    name: "Bonk",
    decimals: 5,
    hue: "#f5a524",
    glyph: "🐕",
    chartPair: null,
  },
  {
    mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
    symbol: "JUP",
    name: "Jupiter",
    decimals: 6,
    hue: "#32d3a5",
    glyph: "♃",
    chartPair: null,
  },
  {
    mint: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
    symbol: "WIF",
    name: "dogwifhat",
    decimals: 6,
    hue: "#d97b5a",
    glyph: "🧢",
    chartPair: null,
  },
  {
    mint: "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3",
    symbol: "PYTH",
    name: "Pyth Network",
    decimals: 6,
    hue: "#7c5cff",
    glyph: "◈",
    chartPair: null,
  },
  {
    mint: "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL",
    symbol: "JTO",
    name: "Jito",
    decimals: 9,
    hue: "#4fc3d9",
    glyph: "◉",
    chartPair: null,
  },
  {
    mint: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R",
    symbol: "RAY",
    name: "Raydium",
    decimals: 6,
    hue: "#3f6fff",
    glyph: "☈",
    chartPair: null,
  },
  {
    mint: "orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE",
    symbol: "ORCA",
    name: "Orca",
    decimals: 6,
    hue: "#ffd15c",
    glyph: "🐋",
    chartPair: null,
  },
  {
    mint: "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr",
    symbol: "POPCAT",
    name: "Popcat",
    decimals: 9,
    hue: "#e2a445",
    glyph: "🐱",
    chartPair: null,
  },
  {
    mint: "MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5",
    symbol: "MEW",
    name: "cat in a dogs world",
    decimals: 5,
    hue: "#9b7cf0",
    glyph: "😺",
    chartPair: null,
  },
  {
    mint: USDC_MINT,
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    hue: "#2775ca",
    glyph: "$",
    chartPair: null,
  },
];

const BY_MINT = new Map(SOLANA_MARKETS.map((m) => [m.mint, m]));
const BY_SYMBOL = new Map(SOLANA_MARKETS.map((m) => [m.symbol.toUpperCase(), m]));

export function marketByMint(mint: string): SolanaMarket | null {
  return BY_MINT.get(mint) ?? null;
}

/**
 * Symbol lookup, for the known list ONLY.
 *
 * This is not token resolution and must never be used as such — it answers
 * "is this one of the markets cipher lists", not "what does this word mean".
 * Anything the user types goes through lib/chain/tokens.ts, which knows that
 * the symbol `BONK` belongs to an impostor with two holders.
 */
export function listedSymbol(symbol: string): SolanaMarket | null {
  return BY_SYMBOL.get(symbol.trim().toUpperCase()) ?? null;
}

export const ALL_MINTS = SOLANA_MARKETS.map((m) => m.mint);

const BY_PAIR = new Map(
  SOLANA_MARKETS.filter((m) => m.chartPair).map((m) => [m.chartPair as string, m]),
);

/**
 * THE MINT BEHIND A MARKET KEY, whatever shape the key arrives in.
 *
 * The engine keys a rule on `market`, and for a long time the browser filled
 * that with a Binance pair — "SOLUSDT" — because that is what the chart and
 * the navigator speak. The worker then asked Jupiter for the price of a token
 * called SOLUSDT, got nothing, and skipped the market. Every rule armed in a
 * browser was unfireable by the one thing built to fire it, and the only
 * reason it was not silent is that the worker reports what it skipped.
 *
 * So the translation happens ONCE, at the edge where a market key enters the
 * engine, and the mint is what gets written down. `MARKETS keys on a Binance
 * pair today` is a trap already named in CLAUDE.md; this is where it stops.
 *
 * Returns null for a market cipher does not list on Solana — BTC, XRP and the
 * rest of the Binance majors. Those are chart-only, and a null here is what
 * keeps a rule from being armed against a price that has no venue behind it.
 */
export function mintFor(key: string): string | null {
  const k = key.trim();
  return (BY_MINT.get(k) ?? BY_PAIR.get(k) ?? BY_SYMBOL.get(k.toUpperCase()))?.mint ?? null;
}

/**
 * What to call a market on screen, given whatever key a rule carries.
 *
 * Separate from `mintFor` because display must never fail: `marketOf` falls
 * back to MARKETS[0] for anything it does not recognise, so a mint handed to
 * it would quietly render as BTC — an alert claiming to watch the wrong coin.
 */
export function baseSymbol(key: string): string {
  return marketByMint(key)?.symbol ?? BY_PAIR.get(key)?.symbol ?? marketOf(key).base;
}
