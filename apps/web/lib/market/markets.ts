import type { Major } from "./types";

/**
 * The market list behind the left panel.
 *
 * cipher ran one hardcoded market until now, which is why the left panel was a
 * feed rather than a navigator. A token list is the primary control on every
 * trading terminal — it is how you change what you are looking at — so the
 * symbol has to be data rather than a constant before anything else can move.
 *
 * Binance's 24hr ticker gives price, change and volume for every symbol in one
 * keyless request. It does NOT give supply, so market cap is computed from a
 * table below.
 *
 * cipher: this is a centralised list of majors, not Solana pools. It exists to
 * make the navigator real while the on-chain data path is built. When Geyser
 * and a pool index land, MARKETS becomes a query and only this file changes.
 */

const TICKER = "https://api.binance.com/api/v3/ticker/24hr";
const DEPTH = "https://api.binance.com/api/v3/depth";

export interface MarketDef {
  /** Binance pair. The allowlist — never let a caller name an arbitrary one. */
  symbol: string;
  /** What a trader calls it. */
  base: string;
  name: string;
  /**
   * Circulating supply, for market cap.
   *
   * cipher: hardcoded, and it drifts. Supply for a major moves by fractions of
   * a percent a month, so price × supply is accurate to well inside the width
   * of the column it is printed in — but it is a snapshot (Sept 2026), not a
   * feed, and it is wrong for anything with an active emission schedule. A
   * CoinGecko or Birdeye key replaces this table with a field.
   */
  supply: number;
  /** Brand colour for the row mark, since we have no logo files. */
  hue: string;
  glyph: string;
}

/**
 * Ordered the way fomo orders theirs: by market cap, majors first. The order
 * is fixed rather than sorted live so the list does not reshuffle under a
 * cursor that is already moving toward a row.
 */
export const MARKETS: MarketDef[] = [
  { symbol: "BTCUSDT", base: "BTC", name: "Bitcoin", supply: 19_950_000, hue: "#f7931a", glyph: "₿" },
  { symbol: "ETHUSDT", base: "ETH", name: "Ethereum", supply: 120_700_000, hue: "#8098ee", glyph: "Ξ" },
  { symbol: "XRPUSDT", base: "XRP", name: "XRP", supply: 60_500_000_000, hue: "#23292f", glyph: "✕" },
  { symbol: "BNBUSDT", base: "BNB", name: "BNB", supply: 138_500_000, hue: "#f3ba2f", glyph: "◆" },
  { symbol: "SOLUSDT", base: "SOL", name: "Solana", supply: 600_000_000, hue: "#14f195", glyph: "◎" },
  { symbol: "DOGEUSDT", base: "DOGE", name: "Dogecoin", supply: 150_000_000_000, hue: "#c2a633", glyph: "Ð" },
  { symbol: "TRXUSDT", base: "TRX", name: "TRON", supply: 94_600_000_000, hue: "#ff060a", glyph: "▽" },
  { symbol: "ADAUSDT", base: "ADA", name: "Cardano", supply: 36_400_000_000, hue: "#0033ad", glyph: "₳" },
  { symbol: "LINKUSDT", base: "LINK", name: "Chainlink", supply: 680_000_000, hue: "#2a5ada", glyph: "⬡" },
  { symbol: "AVAXUSDT", base: "AVAX", name: "Avalanche", supply: 425_000_000, hue: "#e84142", glyph: "▲" },
  { symbol: "SUIUSDT", base: "SUI", name: "Sui", supply: 3_450_000_000, hue: "#4da2ff", glyph: "◈" },
  { symbol: "LTCUSDT", base: "LTC", name: "Litecoin", supply: 76_000_000, hue: "#a6a9aa", glyph: "Ł" },
  { symbol: "DOTUSDT", base: "DOT", name: "Polkadot", supply: 1_570_000_000, hue: "#e6007a", glyph: "●" },
  { symbol: "ZECUSDT", base: "ZEC", name: "Zcash", supply: 16_400_000, hue: "#ecb244", glyph: "ⓩ" },
];

const BY_SYMBOL = new Map(MARKETS.map((m) => [m.symbol, m]));

/**
 * The allowlist check.
 *
 * The symbol arrives from a query string and is interpolated straight into an
 * upstream URL, so it is validated against the table rather than pattern
 * matched. A regex that accepts /[A-Z]+USDT/ still lets a caller point our
 * server at any pair on the exchange and use us as an open proxy.
 */
export function isMarket(v: string): boolean {
  return BY_SYMBOL.has(v);
}

export function marketOf(symbol: string): MarketDef {
  return BY_SYMBOL.get(symbol) ?? MARKETS[0];
}

/** Binance /ticker/24hr, the fields we use. */
interface Ticker {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  quoteVolume: string;
}

/**
 * Every row's price, change and cap in ONE request.
 *
 * Binance accepts a symbols= array, which matters: fourteen individual calls
 * is fourteen round trips and fourteen chances to be rate limited, and the
 * rows would land at visibly different times.
 */
export async function fetchMajors(): Promise<Major[]> {
  const symbols = JSON.stringify(MARKETS.map((m) => m.symbol));
  const res = await fetch(`${TICKER}?symbols=${encodeURIComponent(symbols)}`, {
    headers: { Accept: "application/json" },
    // A list is glanced at, not traded off. Ten seconds is well inside the
    // rate limit and still moves while you watch it.
    next: { revalidate: 10 },
  });
  if (!res.ok) throw new Error(`Binance ticker ${res.status}`);

  const rows = (await res.json()) as Ticker[];
  const byId = new Map(rows.map((r) => [r.symbol, r]));

  /*
   * Mapped over MARKETS rather than over the response, so the list keeps its
   * fixed order and a symbol the exchange stops quoting drops out cleanly
   * instead of reordering everything below it.
   */
  return MARKETS.flatMap<Major>((m) => {
    const t = byId.get(m.symbol);
    if (!t) return [];
    const priceUsd = +t.lastPrice;
    return [
      {
        id: m.symbol,
        symbol: m.base,
        imageUrl: null,
        priceUsd,
        change24h: +t.priceChangePercent,
        marketCap: priceUsd * m.supply,
      },
    ];
  });
}

/**
 * Resting liquidity, in dollars, from the top of the order book.
 *
 * fomo's fourth stat box is a Solana pool's liquidity. A centralised pair has
 * no pool, but it has the thing that number is actually FOR: how much you can
 * trade through before you move the price. That is the book, so it is the
 * book we sum.
 *
 * Only the top 100 levels a side. The full book includes orders parked 40%
 * away that will never fill anything, and counting them produces a large
 * number that describes no tradeable depth at all.
 */
export async function fetchDepth(symbol: string): Promise<number> {
  const res = await fetch(`${DEPTH}?symbol=${symbol}&limit=100`, {
    headers: { Accept: "application/json" },
    next: { revalidate: 15 },
  });
  if (!res.ok) throw new Error(`Binance depth ${res.status}`);

  const book = (await res.json()) as { bids: [string, string][]; asks: [string, string][] };
  const side = (levels: [string, string][]) =>
    levels.reduce((sum, [p, q]) => sum + +p * +q, 0);

  return side(book.bids) + side(book.asks);
}

/**
 * What the user called it, resolved to a market.
 *
 * The grammar captures whatever word follows an amount — "sol", "solana",
 * "SOL" — and until now nothing checked it against the market actually open.
 * That was a live bug: "buy $500 of BONK" while SOL was on screen bought SOL,
 * silently, because execution used the loaded price and never looked at the
 * token in the sentence.
 *
 * Matches the ticker or the name, both case-insensitively. Returns null rather
 * than guessing — a wrong guess here spends real money on the wrong asset, and
 * "I do not know that one" is always the safer answer.
 *
 * cipher: a fourteen-row table. On Solana this becomes a mint lookup against a
 * verified list, and the symbol stops being an identifier entirely — anyone
 * can mint a token called BONK.
 */
export function resolveMarket(token: string): MarketDef | null {
  const t = token.trim().toLowerCase();
  if (!t) return null;
  return (
    MARKETS.find((m) => m.base.toLowerCase() === t || m.name.toLowerCase() === t) ?? null
  );
}
