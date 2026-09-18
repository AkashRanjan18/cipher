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

const TICKER = "https://lite-api.jup.ag/tokens/v2/search";
const DEPTH = "https://api.binance.com/api/v3/depth";

interface JupiterRow {
  id: string;
  icon: string | null;
  usdPrice: number;
  mcap: number | null;
  fdv: number | null;
  stats24h?: { priceChange?: number; buyVolume?: number };
}

export interface MarketDef {
  /**
   * THE MINT. Was a Binance pair; it is an address now.
   *
   * Everything downstream already branches on `looksLikeMint()`, so making
   * this an address is what routes majors through the Solana path — Jupiter
   * quotes, GeckoTerminal candles, a ticket that can actually buy them —
   * without a single caller changing.
   */
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
/*
 * THREE MINTS, NOT FOURTEEN PAIRS.
 *
 * This was fourteen Binance symbols, and every one of them was a coin you
 * could look at and not buy: `mintFor` returns null for a Binance pair, so the
 * ticket read "BTC is chart-only" on all of them. A tab full of controls that
 * do nothing is the thing CLAUDE.md's design rule exists to delete.
 *
 * It also broke in production. Binance geo-blocks US IPs and Vercel runs in
 * Washington, so every price rendered "—" while working perfectly on a laptop
 * in India — the function was refused from the building it ran in.
 *
 * Both problems have the same fix: use the wrapped assets that already live on
 * Solana. They are real mints with real pools, Jupiter routes them like any
 * other token, and GeckoTerminal charts them. Majors stop being a special case
 * with their own exchange, their own candle feed and their own failure mode.
 *
 * ONLY THREE SURVIVE, and that is a finding rather than a choice. Checked
 * against Jupiter: WBTC has $36M of liquidity and Portal ETH $22M. After that
 * it falls off a cliff — wXRP $0.9M, LINK $0.2M, ADA and AVAX and DOT nothing
 * at all. Worse, searching "DOGE" returns BITDOGE and BLACKDOGE, which are
 * memecoins wearing the name, and "DOT" returns a token called Y2K. Mapping
 * tickers to mints by hand is exactly the impostor trap tokens.ts exists to
 * prevent, so the list stops where the liquidity stops.
 *
 * THE DISPLAYED NAME IS THE ASSET, NOT THE WRAPPER. A trader thinks in BTC,
 * not "Wrapped BTC (Portal)". The mint is the identity and the ticker is a
 * display string — the same rule the rest of the codebase already follows.
 */
export const MARKETS: MarketDef[] = [
  {
    symbol: "So11111111111111111111111111111111111111112",
    base: "SOL",
    name: "Solana",
    supply: 600_000_000,
    hue: "#14f195",
    glyph: "◎",
  },
  {
    symbol: "3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh",
    base: "BTC",
    name: "Bitcoin",
    supply: 19_950_000,
    hue: "#f7931a",
    glyph: "₿",
  },
  {
    symbol: "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs",
    base: "ETH",
    name: "Ethereum",
    supply: 120_700_000,
    hue: "#8098ee",
    glyph: "Ξ",
  },
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
  const ids = MARKETS.map((m) => m.symbol).join(",");
  const res = await fetch(`${TICKER}?query=${ids}`, {
    headers: { Accept: "application/json" },
    // A list is glanced at, not traded off. Ten seconds is well inside the
    // allowance and still moves while you watch it.
    next: { revalidate: 10 },
  });
  if (!res.ok) throw new Error(`Jupiter tokens ${res.status}`);

  const rows = (await res.json()) as JupiterRow[];
  const byMint = new Map(rows.map((r) => [r.id, r]));

  /*
   * Mapped over MARKETS rather than over the response, so the list keeps its
   * fixed order and a mint the feed stops quoting drops out cleanly instead of
   * reordering everything below it.
   */
  return MARKETS.flatMap<Major>((m) => {
    const t = byMint.get(m.symbol);
    if (!t || !(t.usdPrice > 0)) return [];
    return [
      {
        id: m.symbol,
        symbol: m.base,
        /* The row falls back to the brand hue and glyph when this is null,
           which is what CoinMark already does — and for BTC, ETH and SOL it
           prefers the verified local file anyway. */
        imageUrl: t.icon ?? null,
        priceUsd: t.usdPrice,
        change24h: t.stats24h?.priceChange ?? 0,
        /*
         * WHAT IS BRIDGED, NOT WHAT EXISTS.
         *
         * Jupiter reports the cap of the mint on THIS chain, so BTC reads
         * ~$190M rather than Bitcoin's trillions — that is the size of the
         * wrapped supply on Solana, which is the honest number for a Solana
         * terminal and the one that bounds what you can actually trade
         * against. SOL's is the real thing, because SOL is native here.
         */
        marketCap: t.mcap ?? t.fdv ?? t.usdPrice * m.supply,
        volume24hUsd: t.stats24h?.buyVolume ?? 0,
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
