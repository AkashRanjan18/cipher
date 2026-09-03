"use client";

import { useEffect, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  ColorType,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
} from "lightweight-charts";
import { foldLivePrice, type Candle } from "@/lib/market";

/**
 * Price chart.
 *
 * lightweight-charts renders to canvas and imperatively owns its DOM node, so
 * it lives behind a ref and is created once in an effect rather than described
 * in JSX. React never re-renders it — data goes in through the series API.
 *
 * v5 API: chart.addSeries(CandlestickSeries, opts). v4's addCandlestickSeries()
 * no longer exists, and most examples online are still v4.
 */

const INK = "#0b0910";
const ASH = "#8b8598";
const UP = "#4ade80";
const DOWN = "#f87171";

const volumeColor = (c: Candle) =>
  c.close >= c.open ? "rgba(74,222,128,0.3)" : "rgba(248,113,113,0.3)";

export function PriceChart({
  candles,
  livePrice,
  barSeconds,
}: {
  candles: Candle[];
  /** Latest traded price, from the shared poll. Folds into the forming bar. */
  livePrice?: number;
  /** Seconds per bar, so "now" can be placed in the right bucket. */
  barSeconds: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const priceSeries = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeries = useRef<ISeriesApi<"Histogram"> | null>(null);

  /*
   * The bar currently forming. Held in a ref, not state, because it changes on
   * every tick and is pushed into the canvas directly — putting it in state
   * would re-render React for a pixel change the canvas already made.
   */
  const forming = useRef<Candle | null>(null);

  /** Whatever the crosshair is over, or the last bar when it is off the chart. */
  const [legend, setLegend] = useState<Candle | null>(null);

  /*
   * CREATE. Empty deps: the chart is built once and outlives every data
   * change. Rebuilding it per update — which is what listing `candles` here
   * would do — throws away zoom and pan on every poll, and on a live chart
   * that makes the whole pane unusable.
   */
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

    /*
     * The OHLC legend. Reading exact values off a candle by eye is guesswork,
     * so every terminal prints the hovered bar. Leaving the chart falls back
     * to the newest bar rather than blanking — an empty legend reads as a
     * broken panel.
     */
    c.subscribeCrosshairMove((param) => {
      const bar = param.seriesData.get(price) as
        | { open: number; high: number; low: number; close: number }
        | undefined;
      if (!bar || param.time === undefined) {
        setLegend(forming.current);
        return;
      }
      setLegend({ time: Number(param.time), ...bar, volume: 0 });
    });

    chart.current = c;
    priceSeries.current = price;
    volumeSeries.current = volume;

    // Without this the canvas leaks on every navigation.
    return () => {
      c.remove();
      chart.current = null;
      priceSeries.current = null;
      volumeSeries.current = null;
    };
  }, []);

  /*
   * LOAD. Runs when the server hands over a different series — a token change
   * or an interval switch. setData replaces the whole set; fitContent frames
   * it, which is right here and wrong on a tick.
   */
  useEffect(() => {
    const price = priceSeries.current;
    const volume = volumeSeries.current;
    if (!price || !volume || candles.length === 0) return;

    price.setData(candles as never);
    volume.setData(
      candles.map((d) => ({
        time: d.time,
        value: d.volume,
        color: volumeColor(d),
      })) as never,
    );
    chart.current?.timeScale().fitContent();

    // The newest bar from the server becomes the one live prices extend.
    forming.current = candles[candles.length - 1] ?? null;
    setLegend(forming.current);
  }, [candles]);

  /*
   * TICK. Folds the polled price into the forming bar — the same arithmetic
   * an exchange does: a trade inside the current bucket extends that bar's
   * high, low and close; a trade past the boundary opens the next bar.
   *
   * update() touches a single bar, so zoom, pan and the crosshair all survive.
   */
  useEffect(() => {
    const price = priceSeries.current;
    const last = forming.current;
    if (!price || !last || livePrice === undefined || livePrice <= 0) return;

    const next = foldLivePrice(last, livePrice, barSeconds);

    forming.current = next;
    price.update(next as never);
    setLegend(next);
  }, [livePrice, barSeconds]);

  if (candles.length === 0) {
    return (
      <div className="flex h-full min-h-[240px] items-center justify-center rounded-2xl border border-champagne/10 bg-slate">
        <p className="font-sans text-sm text-ash">
          No price history for this pool.
        </p>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <div ref={box} className="h-full w-full" />

      {legend && (
        /* pointer-events-none: the legend sits over the canvas, and swallowing
           the mouse there would kill the crosshair that feeds it. */
        <div className="pointer-events-none absolute left-2 top-2 z-10 flex gap-3 rounded bg-ink/80 px-2 py-1 font-mono text-[10px] tabular-nums backdrop-blur-sm">
          {(
            [
              ["O", legend.open],
              ["H", legend.high],
              ["L", legend.low],
              ["C", legend.close],
            ] as const
          ).map(([k, v]) => (
            <span key={k} className="text-ash">
              {k}{" "}
              <span
                className={
                  legend.close >= legend.open
                    ? "text-green-400"
                    : "text-red-400"
                }
              >
                {v.toPrecision(4)}
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
