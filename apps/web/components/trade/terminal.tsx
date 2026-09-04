"use client";

import { useEffect, useState, useTransition } from "react";
import type { Candle, Interval } from "@/lib/market";
import {
  SYMBOL,
  INTERVAL_ORDER,
  intervalSeconds,
  subscribeCandles,
} from "@/lib/market";
import { PriceChart } from "./price-chart";
import { PromptPanel } from "./prompt-panel";
import { TradePanel } from "./trade-panel";

/**
 * The client shell around the chart.
 *
 * Holds the three things that change without a navigation — the selected
 * interval, the candle set, and the live bar. Everything else stays server
 * rendered.
 *
 * Split out from the page so the page can stay a server component and fetch
 * the first candles before the browser sees anything.
 */
export function Terminal({
  initial,
  initialInterval,
}: {
  initial: Candle[];
  initialInterval: Interval;
}) {
  const [interval, setInterval] = useState<Interval>(initialInterval);
  const [candles, setCandles] = useState<Candle[]>(initial);
  const [live, setLive] = useState<number | undefined>(undefined);
  const [pending, startTransition] = useTransition();

  /*
   * Refetch when the interval changes — but not on mount, because the server
   * already fetched this exact set and refetching it would blank the chart
   * for one round trip on every page load.
   */
  useEffect(() => {
    if (interval === initialInterval) {
      setCandles(initial);
      return;
    }
    let alive = true;
    startTransition(async () => {
      const res = await fetch(`/api/candles?interval=${interval}`);
      if (!res.ok || !alive) return;
      const { candles: next } = (await res.json()) as { candles: Candle[] };
      if (alive) setCandles(next);
    });
    return () => {
      alive = false;
    };
  }, [interval, initial, initialInterval]);

  /*
   * The live bar, pushed over a websocket rather than polled. This is the
   * difference between a chart that ticks and one that steps: a poll moves
   * the last bar once per interval, a stream moves it on every trade.
   *
   * Resubscribes on interval change because the stream is per-interval.
   */
  useEffect(() => {
    return subscribeCandles(interval, (c) => setLive(c.close));
  }, [interval]);

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <header className="flex shrink-0 items-center justify-between border-b border-champagne/10 px-6 py-4">
        <a href="/" className="font-display text-2xl lowercase">
          cipher
        </a>
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-sm text-champagne">{SYMBOL}</span>
          {live !== undefined && (
            <span className="font-mono text-lg tabular-nums text-champagne">
              ${live.toFixed(2)}
            </span>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 gap-4 p-4">
        <section className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex shrink-0 items-center gap-1">
            {INTERVAL_ORDER.map((i) => (
              <button
                key={i}
                onClick={() => setInterval(i)}
                className={`rounded px-3 py-1.5 font-mono text-xs transition-colors ${
                  i === interval
                    ? "bg-champagne/12 text-champagne"
                    : "text-ash hover:text-champagne"
                }`}
              >
                {i}
              </button>
            ))}
            {pending && (
              <span className="ml-2 font-mono text-xs text-ash">loading…</span>
            )}
          </div>

          <div className="min-h-0 flex-1">
            <PriceChart
              candles={candles}
              livePrice={live}
              barSeconds={intervalSeconds(interval)}
            />
          </div>
        </section>

        <aside className="flex w-[340px] shrink-0 flex-col gap-4 overflow-y-auto">
          <PromptPanel />
          <TradePanel token="SOL" />
        </aside>
      </div>
    </div>
  );
}
