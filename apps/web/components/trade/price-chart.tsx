"use client";

import { useEffect, useRef } from "react";
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  ColorType,
  CrosshairMode,
  type IChartApi,
} from "lightweight-charts";
import type { Candle } from "@/lib/market";

/**
 * Price chart.
 *
 * lightweight-charts renders to canvas and imperatively owns its DOM node, so
 * it lives behind a ref and is created once in an effect rather than described
 * in JSX. React never re-renders it — data updates go through the series API.
 *
 * v5 API: chart.addSeries(CandlestickSeries, opts). v4's addCandlestickSeries()
 * no longer exists, and most examples online are still v4.
 */

const INK = "#0b0910";
const ASH = "#8b8598";
const UP = "#4ade80";
const DOWN = "#f87171";

export function PriceChart({ candles }: { candles: Candle[] }) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!box.current) return;

    const c = createChart(box.current, {
      layout: {
        // The canvas paints its own background; without this it is white.
        background: { type: ColorType.Solid, color: INK },
        textColor: ASH,
        fontFamily: "var(--font-mono), monospace",
      },
      grid: {
        vertLines: { color: "rgba(243,233,216,0.04)" },
        horzLines: { color: "rgba(243,233,216,0.04)" },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "rgba(243,233,216,0.10)" },
      timeScale: { borderColor: "rgba(243,233,216,0.10)", timeVisible: true },
      autoSize: true,
    });
    chart.current = c;

    const price = c.addSeries(CandlestickSeries, {
      upColor: UP,
      downColor: DOWN,
      borderVisible: false,
      wickUpColor: UP,
      wickDownColor: DOWN,
      /*
       * Memecoins trade around 3e-6. The default formatter rounds that to
       * 0.00 and every candle collapses onto a single flat line.
       */
      priceFormat: { type: "price", precision: 9, minMove: 0.000000001 },
    });

    const volume = c.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      // Its own scale, so volume does not squash the price series.
      priceScaleId: "volume",
    });
    c.priceScale("volume").applyOptions({
      // Volume occupies the bottom fifth; price keeps the rest.
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    price.setData(candles as never);
    volume.setData(
      candles.map((d) => ({
        time: d.time,
        value: d.volume,
        color:
          d.close >= d.open ? "rgba(74,222,128,0.3)" : "rgba(248,113,113,0.3)",
      })) as never,
    );

    c.timeScale().fitContent();

    // Without this the canvas leaks on every navigation.
    return () => {
      c.remove();
      chart.current = null;
    };
  }, [candles]);

  if (candles.length === 0) {
    return (
      <div className="flex h-[360px] items-center justify-center rounded-2xl border border-champagne/10 bg-slate">
        <p className="font-sans text-sm text-ash">
          No price history for this pool.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={box}
      className="h-[360px] overflow-hidden rounded-2xl border border-champagne/10"
      style={{ backgroundColor: INK }}
    />
  );
}
