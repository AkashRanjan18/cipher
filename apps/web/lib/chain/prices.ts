/**
 * Prices from Solana, not from an exchange.
 *
 * Jupiter derives these from the same routes a swap would take, so the number
 * a trigger compares against is the number the trade would actually get. That
 * is the entire reason this file replaces the Binance feed in the trigger path:
 * a rule that watches one venue and executes on another is making a promise it
 * has no way to keep.
 *
 * THE BLOCK ID IS THE IMPORTANT FIELD. Every price carries the Solana slot it
 * was derived at, which makes staleness detectable rather than assumed — a
 * feed that stops moving looks identical to a market that stopped moving,
 * until you can see that the chain advanced and the price did not.
 */

const BASE = "https://lite-api.jup.ag/price/v3";

export interface SolPrice {
  mint: string;
  usd: number;
  /** The Solana slot this was derived at. Proof of freshness, not decoration. */
  blockId: number;
  decimals: number;
  /** Pool depth behind the price, in dollars. */
  liquidityUsd: number;
  change24h: number;
}

export class PriceError extends Error {}

/**
 * Batched, because a price is a property of a market and not of a user.
 *
 * Ten thousand armed rules on eleven markets are eleven prices, fetched once.
 * The whole design of the sorted index depends on this being true — a fetch
 * per rule would put the network in the hot path and make the binary search
 * pointless.
 */
export async function fetchPrices(mints: string[], signal?: AbortSignal): Promise<Map<string, SolPrice>> {
  const out = new Map<string, SolPrice>();
  const unique = [...new Set(mints)].filter(Boolean);
  if (unique.length === 0) return out;

  /*
   * Chunked at 50. The endpoint takes a comma-separated list with a limit, and
   * a URL that silently truncates would drop prices for markets that have
   * armed rules on them — a rule that never fires because its price was never
   * fetched is the worst possible failure, since nothing reports it.
   */
  for (let i = 0; i < unique.length; i += 50) {
    const batch = unique.slice(i, i + 50);
    const res = await fetch(`${BASE}?ids=${batch.join(",")}`, {
      headers: { Accept: "application/json" },
      signal,
    });
    if (!res.ok) throw new PriceError(`Jupiter price returned ${res.status}`);

    const body = (await res.json()) as Record<string, Record<string, unknown>>;
    for (const [mint, raw] of Object.entries(body ?? {})) {
      const usd = Number(raw?.usdPrice);
      if (!Number.isFinite(usd) || usd <= 0) continue;
      out.set(mint, {
        mint,
        usd,
        blockId: Number(raw?.blockId ?? 0),
        decimals: Number(raw?.decimals ?? 0),
        liquidityUsd: Number(raw?.liquidity ?? 0),
        change24h: Number(raw?.priceChange24h ?? 0),
      });
    }
  }

  return out;
}

/**
 * Has the chain moved while this price stood still?
 *
 * Solana produces a slot roughly every 400ms, so a few hundred slots is a
 * couple of minutes of the feed being stuck. A price that is merely FLAT looks
 * exactly like a feed that has died — the block id is what separates them, and
 * a trigger engine acting on a dead feed is worse than one that admits it
 * cannot see.
 */
const STALE_SLOTS = 300;

export function isStale(price: SolPrice, currentBlockId: number): boolean {
  if (!currentBlockId || !price.blockId) return false;
  return currentBlockId - price.blockId > STALE_SLOTS;
}

/** The newest slot any price in a batch was derived at. */
export function newestBlock(prices: Map<string, SolPrice>): number {
  let max = 0;
  for (const p of prices.values()) if (p.blockId > max) max = p.blockId;
  return max;
}

/**
 * Every price in the batch, keyed the way the trigger engine wants it.
 *
 * The engine keys on a market string. On Solana that string is the mint, which
 * is the only identifier that cannot be forged — a symbol can be minted by
 * anyone for a couple of dollars, and `MARKETS` keyed on a Binance pair was
 * only ever safe because the exchange guaranteed it.
 */
export function toMarketPrices(prices: Map<string, SolPrice>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [mint, p] of prices) out[mint] = p.usd;
  return out;
}
