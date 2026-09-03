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
      </div>

      <div className="min-h-0 flex-1">
        <PriceChart
          candles={candles}
          livePrice={stats.priceUsd}
          barSeconds={intervalSeconds(interval)}
        />
      </div>
    </div>
  );
}
