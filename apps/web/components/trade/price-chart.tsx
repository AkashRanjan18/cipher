"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import { CHART_MARKS } from "@/lib/social/mock";
import { Avatar } from "./avatar";

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

/*
 * The canvas cannot read CSS variables — lightweight-charts wants literal
 * colours — so the theme is resolved once, here, off the document element.
 *
 * These used to be four hardcoded hexes, and they had drifted: the candles
 * were #4ade80 while --color-up was #22c98a, so the chart's green and every
 * other green on the page were different greens and nobody could say which
 * was the real one. Reading the tokens means the palette has one home.
 */
function token(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name);
  return v.trim() || fallback;
}

/** fomo washes their volume bars back to a fifth. Solid bars fight the candles. */
function wash(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

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

const volumeColor = (c: Candle, up: string, down: string) =>
  c.close >= c.open ? wash(up, 0.3) : wash(down, 0.3);

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

    const INK = token("--color-ink", "#060510");
    const ASH = token("--color-ash", "#9899a3");
    const UP = token("--color-up", "#21c95e");
    const DOWN = token("--color-down", "#ff622e");
    // The grid and the axis borders are the same translucent lavender the
    // panels use, so the chart is bounded like every other surface.
    const LINE = token("--color-line", "rgba(203,208,235,0.1)");
    const GRID = token("--color-hairline", "rgba(203,208,235,0.06)");

    const c = createChart(box.current, {
      layout: {
        // The canvas paints its own background; without this it is white.
        background: { type: ColorType.Solid, color: INK },
        textColor: ASH,
        fontFamily: "var(--font-mono), monospace",
      },
      grid: {
        vertLines: { color: GRID },
        horzLines: { color: GRID },
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
      rightPriceScale: { borderColor: LINE },
      timeScale: { borderColor: LINE, timeVisible: true },
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
        color: volumeColor(
          d,
          token("--color-up", "#21c95e"),
          token("--color-down", "#ff622e"),
        ),
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

  /*
   * WHO TRADED, ON THE CHART.
   *
   * fomo puts trader avatars directly on their candles, and it is the single
   * detail that makes their chart look inhabited rather than plotted. The
   * data has been sitting in CHART_MARKS unused since the mock was written.
   *
   * lightweight-charts can only draw its own marker shapes, so these are DOM
   * nodes positioned over the canvas: timeToCoordinate for x, priceToCoordinate
   * for y. Which means they have to be recomputed on every pan, zoom and new
   * bar, or they drift off the candle they belong to.
   *
   * These three hooks sit above the empty-candles early return, not next to
   * the markup they feed. `candles` is empty on the first render while the
   * fetch is in flight, so declaring them after the return runs fewer hooks on
   * that pass and React throws "Rendered fewer hooks than expected" the moment
   * the data lands.
   */
  const [marks, setMarks] = useState<
    { key: string; who: string; side: "buy" | "sell"; x: number; y: number }[]
  >([]);

  const placeMarks = useCallback(() => {
    const c = chart.current;
    const price = priceSeries.current;
    if (!c || !price || candles.length === 0) return setMarks([]);

    const ts = c.timeScale();
    const next: typeof marks = [];

    // The pane's own height, to keep a marker inside it — see the clamp below.
    const height = box.current?.clientHeight ?? 0;
    const PAD = 14;

    for (const m of CHART_MARKS) {
      const bar = candles[Math.round(m.at * (candles.length - 1))];
      if (!bar) continue;

      const x = ts.timeToCoordinate(bar.time as never);
      // Sit buys under the low and sells above the high, so a marker never
      // covers the candle it refers to.
      const y = price.priceToCoordinate(m.side === "buy" ? bar.low : bar.high);
      if (x === null || y === null) continue;

      /*
       * Clamp into the pane. A buy on a bar at the bottom of the visible
       * range gets pushed 16px below it, which is past the time axis — the
       * marker then hangs over the axis labels, half cut off. Clamping keeps
       * it on the candle's side of the chart and inside the frame.
       */
      const offY = Number(y) + (m.side === "buy" ? 16 : -16);
      const clamped = Math.min(Math.max(offY, PAD), height - PAD);

      next.push({
        key: `${m.who}${m.at}`,
        who: m.who,
        side: m.side,
        x: Number(x),
        y: clamped,
      });
    }
    setMarks(next);
  }, [candles]);

  useEffect(() => {
    const c = chart.current;
    if (!c) return;
    placeMarks();
    const ts = c.timeScale();
    ts.subscribeVisibleLogicalRangeChange(placeMarks);
    return () => ts.unsubscribeVisibleLogicalRangeChange(placeMarks);
  }, [placeMarks, generation]);

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

      {/*
        pointer-events-none on the layer: it covers the whole canvas, and
        swallowing the mouse would kill the crosshair and the drag-to-pan.
      */}
      <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
        {marks.map((m) => (
          <span
            key={m.key}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: m.x, top: m.y }}
          >
            <span
              className="block rounded-full p-[1.5px]"
              style={{
                background: m.side === "buy" ? "var(--color-up)" : "var(--color-down)",
              }}
            >
              <Avatar who={m.who} size={20} />
            </span>
          </span>
        ))}
      </div>

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
