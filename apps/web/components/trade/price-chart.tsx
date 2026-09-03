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

/**
 * How many decimals this series needs.
 *
 * A memecoin at 3e-6 needs nine or every candle collapses onto one flat line;
 * the same token viewed as a $278M market cap needs none, and nine would
 * render "278,840,192.000000000". The axis has to follow the magnitude.
 */
function precisionFor(candles: Candle[]): number {
  const last = candles[candles.length - 1]?.close ?? 0;
  if (last >= 1000) return 2;
  if (last >= 1) return 4;
  return 9;
}

const volumeColor = (c: Candle) =>
  c.close >= c.open ? "rgba(34,201,138,0.3)" : "rgba(255,84,112,0.3)";

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
   * Bumped every time a chart instance is built, and listed in the LOAD
   * effect's dependencies.
   *
   * Without it the two effects can desynchronise: React runs effects twice in
   * development, so CREATE builds a chart, the cleanup destroys it, and CREATE
   * builds a second one — but LOAD does not re-run, because `candles` never
   * changed. setData then landed on the destroyed instance and the visible
   * chart stayed empty. Anything that remounts this component in production
   * hits the same path.
   */
  const [generation, setGeneration] = useState(0);

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
      localization: {
        /*
         * The axis is a few characters wide. A market cap printed in full is
         * "310000000.00" — technically correct and unreadable at a glance,
         * which is the only way an axis is ever read.
         */
        priceFormatter: (p: number) => {
          if (p >= 1_000_000_000) return `${(p / 1_000_000_000).toFixed(2)}B`;
          if (p >= 1_000_000) return `${(p / 1_000_000).toFixed(1)}M`;
          if (p >= 1_000) return `${(p / 1_000).toFixed(1)}k`;
          if (p >= 1) return p.toFixed(2);
          return p.toPrecision(3);
        },
      },
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
      // Replaced on every load — see the LOAD effect.
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
    // Tells LOAD there is a new, empty chart waiting for data.
    setGeneration((n) => n + 1);

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

    /*
     * Reapply the format before the data. Switching Price -> MCap moves the
     * series by eight orders of magnitude, and the axis built for one is
     * unreadable for the other.
     */
    const p = precisionFor(candles);
    price.applyOptions({
      priceFormat: { type: "price", precision: p, minMove: 10 ** -p },
    });

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
  }, [candles, generation]);

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
      <div className="flex h-full min-h-[240px] items-center justify-center rounded-2xl border border-line bg-panel">
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
        <div className="pointer-events-none absolute left-2 top-2 z-10 flex gap-3 rounded bg-ink/80 px-2 py-1 font-mono text-[11px] tabular-nums backdrop-blur-sm">
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
                    ? "text-up"
                    : "text-down"
                }
              >
                {v >= 1000
                  ? v.toLocaleString("en-US", { maximumFractionDigits: 0 })
                  : v.toPrecision(4)}
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
