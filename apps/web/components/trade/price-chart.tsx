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

/**
 * Price chart.
 *
 * lightweight-charts renders to canvas and imperatively owns its DOM node, so
 * it lives behind a ref and is created once in an effect rather than described
 * in JSX. React never re-renders it — data goes in through the series API.
 *
 * There used to be a layer of trader avatars and their "thesis" over the
 * candles. Every one of them was invented — made-up people saying made-up
 * things about a real price series — and that is the worst place on the whole
 * page to put fiction, because it sits ON the one thing that is true. Gone,
 * along with the overlay checkboxes that filtered them.
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

/**
 * Volume bars, washed back so they do not fight the candles.
 *
 * ALPHA rather than the pre-flattened solids (#146737 / #83331F): over the
 * chart ground the maths is identical, but alpha also composites correctly
 * over the grid lines crossing behind the bars, where a solid would paint
 * straight over them. It also survives a change of ground colour, which a hex
 * baked against one background does not.
 */
function wash(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** 0.5, per spec. Was 0.3, which left volume nearly invisible on a dark ground. */
const VOLUME_ALPHA = 0.5;

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

/**
 * Pixels per candle when the chart opens, and when it is reset.
 *
 * The chart used to call fitContent() on every load, which frames ALL the
 * data — a thousand bars into about 930 pixels, or 0.93px per candle. At that
 * width a candle has no body, no wick and no colour you can read; the chart
 * became a texture. Nobody trades off a texture.
 *
 * Nine pixels is the width at which a body, both wicks and the direction are
 * all legible, and it is roughly where TradingView's own default sits. It is
 * a SPACING rather than a bar count on purpose: fixing the count would make
 * candles fat on a wide monitor and thin on a laptop, and the whole point is
 * that they are always readable.
 */
const DEFAULT_BAR_SPACING = 9;

/**
 * Empty bars kept to the right of the newest one.
 *
 * Without it the forming candle is welded to the price axis, and the live
 * price label — which sits in the axis — covers the bar it is labelling.
 */
const RIGHT_OFFSET = 12;

const volumeColor = (c: Candle, up: string, down: string) =>
  c.close >= c.open ? wash(up, VOLUME_ALPHA) : wash(down, VOLUME_ALPHA);

/**
 * Strictly ascending by time, keeping the LAST of any duplicate.
 *
 * Last rather than first because the repeated bucket is the one still being
 * filled, and its final copy carries the current close. Returns the input
 * untouched when it is already clean, which is almost always.
 */
function ascending(candles: Candle[]): Candle[] {
  let ok = true;
  for (let i = 1; i < candles.length; i++) {
    if (candles[i].time <= candles[i - 1].time) {
      ok = false;
      break;
    }
  }
  if (ok) return candles;

  const byTime = new Map<number, Candle>();
  for (const c of candles) {
    if (Number.isFinite(c.time)) byTime.set(c.time, c);
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

/**
 * The OHLC readout, and the change on the bar being read.
 *
 * Every terminal prints this because reading a candle's exact values by eye is
 * guesswork. The CHANGE is the part cipher was missing: open and close on
 * their own make you do the subtraction, and the number people actually want
 * from a bar is how far it moved and by what percent.
 *
 * DECIMALS COME FROM THE SERIES, not from a fixed format. `toPrecision(4)`
 * rendered SOL's $103.19 as "103.2" — dropping a cent from the number someone
 * is deciding on — while a memecoin at $0.0000027 needs nine places to say
 * anything at all. The same precision the price axis uses keeps the legend and
 * the scale agreeing.
 */
function Legend({
  bar,
  name,
  interval,
  candles,
}: {
  bar: Candle;
  name: string;
  interval: string;
  candles: Candle[];
}) {
  /*
   * DECIMALS SCALE WITH THE PRICE, and this is the legend's own rule rather
   * than the axis's.
   *
   * `precisionFor` gives four places to anything over a dollar, which renders
   * SOL as "97.1406" — four digits of noise on a number nobody quotes past the
   * cent. Two is what every terminal shows for a dollar-priced asset. But two
   * would render a memecoin at $0.0000027 as "0.00", so the rule has to bend
   * with the magnitude: five significant figures, wherever the decimal point
   * happens to be.
   *
   * BUCKETS DID NOT DELIVER THAT. Thresholds at 0.01 and 0.0001 give a fixed
   * number of places across a hundredfold span, so what you actually got was
   * three to five significant figures depending on where inside a bucket the
   * price sat. PUMP at 0.003495 landed on six places — "0.003495", four
   * figures — against fomo's "0.0035374". Reading one digit short on a coin
   * quoted in ten-thousandths is the difference between two prices.
   *
   * Taking it from the exponent makes it exactly five, everywhere.
   */
  const places = (v: number) => {
    if (v >= 1) return 2;
    /* 0.0035 → exponent -3 → 7 places → 0.0035374. Clamped because a token
       priced at 1e-12 would otherwise ask for a number wider than the panel,
       and because log10(0) is -Infinity. */
    return Math.min(12, Math.max(4, 4 - Math.floor(Math.log10(v))));
  };
  const scale = places(Math.abs(bar.close) || 1);
  /*
   * ABBREVIATED PAST A MILLION, for the same reason the axis is.
   *
   * The two-decimal branch below was written when the series was always a
   * price, where "1,430.72" is exactly right. Switching the chart to market
   * cap made every bar nine digits wide and the legend printed
   * "O64,024,394,253.86 H64,024,394,253.86 L63,607,593,626.38" — four numbers
   * that fill the panel and that nobody can tell apart at a glance, which is
   * the only way a legend is ever read.
   *
   * The thresholds match the axis formatter's deliberately: a legend that
   * says 63.61B under an axis tick reading 63.61B is one reading, and the
   * same number written two ways is two.
   */
  const fmt = (v: number) => {
    const a = Math.abs(v);
    if (a >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(2)}B`;
    if (a >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
    if (a >= 1000)
      return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return v.toFixed(scale);
  };

  /* Against the bar's OWN open — this describes one candle, not the day. */
  const delta = bar.close - bar.open;
  const pct = bar.open > 0 ? (delta / bar.open) * 100 : 0;
  const up = delta >= 0;
  const tone = up ? "text-up" : "text-down";
  const sign = up ? "+" : "";

  return (
    /* pointer-events-none: the legend sits over the canvas, and swallowing the
       mouse there would kill the crosshair that feeds it. */
    <div className="pointer-events-none absolute left-2 top-2 z-10 flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 rounded bg-ink/80 px-2 py-1 font-mono text-[11px] tabular-nums backdrop-blur-sm">
      <span className="font-sans text-[11px] font-bold text-champagne">
        {name} · {interval} · cipher
      </span>

      {(
        [
          ["O", bar.open],
          ["H", bar.high],
          ["L", bar.low],
          ["C", bar.close],
        ] as const
      ).map(([k, v]) => (
        <span key={k} className="text-mute">
          {k}
          <span className={tone}>{fmt(v)}</span>
        </span>
      ))}

      <span className={tone}>
        {sign}
        {fmt(delta)} ({sign}
        {pct.toFixed(2)}%)
      </span>
    </div>
  );
}

export function PriceChart({
  candles,
  livePrice,
  barSeconds,
  name,
  interval,
  resetSignal = 0,
}: {
  candles: Candle[];
  /** What the series is OF. "Solana", "Bonk" — the token, not the ticker. */
  name: string;
  /** Which bar size, for the legend. "1h", "15m". */
  interval: string;
  /** Latest traded price, from the shared poll. Folds into the forming bar. */
  livePrice?: number;
  /** Seconds per bar, so "now" can be placed in the right bucket. */
  barSeconds: number;
  /**
   * Bump to reframe the chart. Alt+R does it from the keyboard; this is the
   * same reset reachable from outside — "reset the chart" is a sentence
   * people say, and the chart's own state was unreachable from the terminal.
   */
  resetSignal?: number;
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

  /**
   * Back to the default view: readable candles, newest bar at the right.
   *
   * TradingView binds this to Alt+R and every chart user has it in their
   * fingers, so it is bound to the same keys here. It is one function rather
   * than two code paths because "how the chart opens" and "what reset gives
   * you" must be the same thing — the moment they differ, reset stops being a
   * way back to somewhere familiar.
   */
  const resetView = useCallback(() => {
    const ts = chart.current?.timeScale();
    if (!ts) return;
    ts.applyOptions({ barSpacing: DEFAULT_BAR_SPACING, rightOffset: RIGHT_OFFSET });
    ts.scrollToRealTime();
  }, []);

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
    const LINE = token("--color-line", "#23212f");
    const GRID = token("--color-hairline", "#191825");

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
      timeScale: {
        borderColor: LINE,
        timeVisible: true,
        barSpacing: DEFAULT_BAR_SPACING,
        rightOffset: RIGHT_OFFSET,
      },
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
    /*
     * HOW MUCH OF THE PANE THE PRICES OCCUPY, which is what decides how long a
     * wick looks.
     *
     * Left at the library default — top 0.2, bottom 0.1 — the series filled
     * 70% of the height. The same candles on fomo fill about 50%, which is why
     * cipher's wicks read as roughly 1.7x longer for data that is, measured
     * against Binance, only about a third wider. Nearly all of the difference
     * was magnification, not the feed.
     *
     * A wick is the same number of DOLLARS either way. Giving the range half
     * the pane instead of seven tenths makes it the number of PIXELS a trader
     * expects, and leaves the headroom that stops a spike touching the frame.
     *
     * The bottom margin also clears the volume strip. Price previously ran to
     * 90% while volume started at 80%, so the histogram was drawn through the
     * bottom of the candles — which on a thin bar is indistinguishable from a
     * long lower wick, and made the problem look worse than it was.
     */
    c.priceScale("right").applyOptions({
      scaleMargins: { top: 0.15, bottom: 0.35 },
    });

    c.priceScale("volume").applyOptions({
      // Its own strip at the very bottom, below where price now stops.
      scaleMargins: { top: 0.85, bottom: 0 },
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
     * THE LIBRARY ASSERTS RATHER THAN COPES, so the invariant is enforced here
     * as well as at every feed.
     *
     *   Assertion failed: data must be asc ordered by time,
     *   index=299, time=1789290840, prev time=1789290840
     *
     * That is a full-screen runtime error over the entire terminal — the
     * chart, the ticket, the balance, all of it — thrown because one upstream
     * repeated a bucket. GeckoTerminal does exactly that with the bucket still
     * forming, and it was fixed there too, but a data feed is a thing that
     * will surprise you again and the app taking itself down is never the
     * right response to a duplicate row.
     *
     * Cheap: already-ascending data is the common case and this is one pass
     * that copies nothing when it holds.
     */
    const clean = ascending(candles);
    if (clean.length === 0) return;

    /*
     * Reapply the format before the data. Switching Price -> MCap moves the
     * series by eight orders of magnitude, and the axis built for one is
     * unreadable for the other.
     */
    const p = precisionFor(clean);
    price.applyOptions({
      priceFormat: { type: "price", precision: p, minMove: 10 ** -p },
    });

    price.setData(clean as never);
    volume.setData(
      clean.map((d) => ({
        time: d.time,
        value: d.volume,
        color: volumeColor(
          d,
          token("--color-up", "#21c95e"),
          token("--color-down", "#ff622e"),
        ),
      })) as never,
    );
    /* Not fitContent(). See DEFAULT_BAR_SPACING — framing a thousand bars is
       what made every candle a hairline. */
    resetView();

    // The newest bar from the server becomes the one live prices extend.
    forming.current = candles[candles.length - 1] ?? null;
    setLegend(forming.current);
  }, [candles, generation, resetView]);

  /* The same reset, asked for from outside. Skips the first run so mounting
     does not count as a request. */
  const firstReset = useRef(true);
  useEffect(() => {
    if (firstReset.current) {
      firstReset.current = false;
      return;
    }
    resetView();
  }, [resetSignal, resetView]);

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

      {/*
        pointer-events-none on the layer: it covers the whole canvas, and
        swallowing the mouse would kill the crosshair and the drag-to-pan.
      */}
      {legend && (
        /* pointer-events-none: the legend sits over the canvas, and swallowing
           the mouse there would kill the crosshair that feeds it. */
        <Legend bar={legend} name={name} interval={interval} candles={candles} />
      )}
    </div>
  );
}
