"use client";

import { useEffect, useState, useTransition } from "react";
import { PriceChart } from "./price-chart";
import { useLive } from "./live-price";
import {
  INTERVAL_ORDER,
  intervalSeconds,
  type Candle,
  type Interval,
} from "@/lib/market";

/**
 * The chart plus its interval tabs.
 *
 * This wrapper exists so PriceChart stays a dumb renderer that takes candles
 * and draws them. Interval state, fetching and the loading flag live here;
 * the canvas code stays free of them. When TradingView's library replaces
 * lightweight-charts, only PriceChart is thrown away — the tabs, the fetch
 * and the layout survive.
 */
/**
 * Circulating supply, implied.
 *
 * Market cap divided by price is the supply the cap was computed from, so
 * multiplying a candle by it gives that candle's cap. Deriving it this way
 * rather than fetching supply separately guarantees the chart's last bar
 * agrees with the market-cap box in the header — two sources would drift.
 *
 * Null when the source has no cap, in which case the toggle is not offered:
 * a market-cap chart with a guessed supply is a fabricated chart.
 */
function impliedSupply(marketCap: number | null, price: number): number | null {
  if (marketCap === null || price <= 0) return null;
  return marketCap / price;
}

export function ChartPanel({
  pair,
  initial,
  initialInterval = "1h",
}: {
  pair: string;
  initial: Candle[];
  initialInterval?: Interval;
}) {
  const [interval, setInterval] = useState<Interval>(initialInterval);
  // The shared poll, so the forming bar tracks the same price as the header.
  const { stats } = useLive();
  const [mode, setMode] = useState<"price" | "mcap">("price");
  const [candles, setCandles] = useState(initial);
  const [pending, start] = useTransition();

  useEffect(() => {
    // The server already fetched this one. Refetching it on mount would
    // double every page load's upstream cost for an identical result.
    if (interval === initialInterval) {
      setCandles(initial);
      return;
    }

    let alive = true;
    start(async () => {
      const res = await fetch(`/api/candles?pair=${pair}&interval=${interval}`);
      if (!res.ok) return;
      const { candles } = (await res.json()) as { candles: Candle[] };
      if (alive) setCandles(candles);
    });

    return () => {
      alive = false;
    };
  }, [interval, pair, initial, initialInterval]);

  const supply = impliedSupply(stats.marketCap, stats.priceUsd);

  /*
   * Market cap is price scaled by a constant, so the candle SHAPE is
   * identical — only the axis changes. Traders read caps, not unit prices,
   * on a token at 3e-6; "is this a $200k or a $200M coin" is the question a
   * unit price cannot answer at a glance.
   */
  const shown =
    mode === "mcap" && supply
      ? candles.map((c) => ({
          ...c,
          open: c.open * supply,
          high: c.high * supply,
          low: c.low * supply,
          close: c.close * supply,
        }))
      : candles;

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-line">
      <div className="flex items-center gap-1 border-b border-line bg-panel px-2 py-2">
        {INTERVAL_ORDER.map((i) => (
          <button
            key={i}
            onClick={() => setInterval(i)}
            aria-pressed={interval === i}
            className={`rounded-md px-2.5 py-1 font-mono text-xs transition-colors ${
              interval === i
                ? "bg-champagne/15 text-champagne"
                : "text-ash hover:text-champagne"
            }`}
          >
            {i}
          </button>
        ))}
        {/* A dot rather than a spinner overlay — the old candles stay
            readable while the new interval loads. */}
        {pending && (
          <span className="ml-1 h-1.5 w-1.5 animate-pulse rounded-full bg-champagne/60" />
        )}

        {/* Offered only when a real supply exists — see impliedSupply. */}
        {supply && (
          <div className="ml-auto flex items-center gap-0.5 rounded-md bg-ink p-0.5">
            {(["price", "mcap"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                aria-pressed={mode === m}
                className={`rounded px-2 py-1 font-sans text-xs capitalize transition-colors ${
                  mode === m
                    ? "bg-champagne/15 text-champagne"
                    : "text-ash hover:text-champagne"
                }`}
              >
                {m === "mcap" ? "MCap" : "Price"}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1">
        <PriceChart
          candles={shown}
          livePrice={mode === "mcap" && supply ? stats.priceUsd * supply : stats.priceUsd}
          barSeconds={intervalSeconds(interval)}
        />
      </div>
    </div>
  );
}
