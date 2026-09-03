import type { Trade } from "./types";

/**
 * The trade tape — every swap that has executed in the pool, newest first.
 *
 * This is the panel that makes a chart feel like a terminal. A candle tells
 * you where price went; the tape tells you whether it went there on one
 * $40,000 buy or four hundred $100 buys, which is the difference between a
 * move you can follow and one you are the exit liquidity for.
 *
 * GeckoTerminal caps this at roughly the last 300 trades and is keyless.
 */

const ENDPOINT = "https://api.geckoterminal.com/api/v2/networks/solana/pools";

interface RawTrade {
  id: string;
  attributes: {
    block_timestamp: string;
    kind: string;
    /** Decimal strings, not numbers — they exceed float precision upstream. */
    price_from_in_usd: string;
    price_to_in_usd: string;
    volume_in_usd: string;
    tx_from_address: string;
    tx_hash: string;
  };
}

/** Exported so the mapping is testable without a network call. */
export function toTrades(rows: RawTrade[]): Trade[] {
  return rows.map((r) => {
    const a = r.attributes;
    return {
      id: r.id,
      // ISO string to unix seconds; the chart and the tape share one clock.
      time: Math.floor(new Date(a.block_timestamp).getTime() / 1000),
      /*
       * `kind` is the side of the token being sold INTO the pool. Anything
       * that is not an explicit "buy" is treated as a sell rather than
       * defaulting the other way — a mislabelled buy paints green on the
       * tape and overstates demand, which is the direction that costs money.
       */
      side: a.kind === "buy" ? "buy" : "sell",
      /*
       * `price_from_in_usd` is the price of whichever token went INTO the
       * pool, so it flips with the side: on a sell that is the token you are
       * charting, on a buy it is SOL. Reading it unconditionally prints
       * SOL's ~$101 on every green row next to BONK's $0.000003 on every red
       * one, which looks like the tape is showing two different assets —
       * because it is.
       */
      priceUsd: Number(
        a.kind === "buy" ? a.price_to_in_usd : a.price_from_in_usd,
      ),
      volumeUsd: Number(a.volume_in_usd),
      wallet: a.tx_from_address,
      txHash: a.tx_hash,
    };
  });
}

export async function fetchTrades(pairAddress: string): Promise<Trade[]> {
  const res = await fetch(`${ENDPOINT}/${pairAddress}/trades`, {
    headers: { Accept: "application/json" },
    /*
     * The tape is the fastest-moving panel; longer than this looks frozen.
     * It is also the single biggest consumer of the shared rate limit, since
     * it is the one panel that polls — see the ceiling note in discover.ts.
     */
    next: { revalidate: 15 },
  });
  if (!res.ok) return [];

  const data = (await res.json()) as { data?: RawTrade[] };
  return toTrades(data.data ?? []);
}
