"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { Candle, Interval } from "@/lib/market";
import { SYMBOL, intervalSeconds, subscribeCandles, marketOf, type MarketDef } from "@/lib/market";
import { usd, pct } from "@/lib/format";
import { PaperAccountProvider, usePaperAccount, OPENING_DEPOSIT } from "@/lib/account/store";
import { TriggerProvider, useTriggers } from "@/lib/triggers/store";
import { mintFor, marketByMint } from "@/lib/chain/markets";
import { looksLikeMint } from "@/lib/chain/tokens";
import { useTokenInfo } from "./use-token-info";
import { SolPriceProvider, useSolPrices } from "./sol-prices";
import { equity, heldMints } from "@/lib/account/paper";
import { PriceChart } from "./price-chart";
import { SidePanel } from "./side-panel";
import { ChartHeader } from "./chart-header";
import { MarketSearch } from "./market-search";
import { StatusBar } from "./status-bar";
import { useMajors } from "./use-majors";
import { Scroller } from "@/components/ui/scroller";
import { AccountMenu } from "@/components/auth/account-menu";
import { MyTrades } from "./my-trades";
import { Ticket } from "./ticket";
import { Sana, SanaMark } from "./sana";
import { Flow } from "./flow";

/**
 * The terminal shell.
 *
 * Layout is fomo's: header with a centred search, a three-column body (market
 * navigator, chart, ticket), and a status bar carrying live prices along the
 * bottom. The social layer is never a tab you go to — it sits beside the chart
 * the whole time, which is the arrangement that makes the design work.
 *
 * The right column is cipher's and stays cipher's: the ticket, the flow panel,
 * and Sana along the bottom. That is where the product differs, so that is
 * where the layout should.
 *
 * This component owns the five things that change without a navigation: the
 * MARKET, the interval, the candle set, the live price, and the layout split.
 * Everything else is a child. The market lives here rather than in the panel
 * that selects it because the chart, the header, the ticket and the websocket
 * all read it — a panel owning it would have to push it up through three
 * components on every click.
 */
export function Terminal(props: {
  initial: Candle[];
  initialInterval: Interval;
  /** Which market opens. A mint on Solana, or a Binance pair for a chart. */
  initialSymbol: string;
}) {
  /*
   * The provider wraps the body rather than sitting inside it, because a
   * component cannot consume a context it provides in the same render — and
   * the header needs the balance.
   */
  return (
    <PaperAccountProvider>
      <SolPriceProvider>
        <TerminalBody {...props} />
      </SolPriceProvider>
    </PaperAccountProvider>
  );
}

function TerminalBody({
  initialSymbol,
  initial,
  initialInterval,
}: {
  initial: Candle[];
  initialInterval: Interval;
  initialSymbol: string;
}) {
  /*
   * Opens on whatever the page chose — the SOL mint, not the Binance pair.
   * Defaulting to SYMBOL here is what made the header and the market list
   * disagree on SOL's price: two venues, one coin, six cents apart.
   */
  const [symbol, setSymbol] = useState<string>(initialSymbol);
  const [interval, setInterval] = useState<Interval>(initialInterval);
  const [candles, setCandles] = useState<Candle[]>(initial);
  const [live, setLive] = useState<number | undefined>(undefined);
  const [depth, setDepth] = useState<number | null>(null);
  const [split, setSplit] = useState<"bottom" | "right">("bottom");

  /*
   * Height of the fills panel, dragged by the divider above it.
   *
   * Held here rather than inside MyTrades because the chart is its sibling —
   * the pixels the panel gains are pixels the chart loses, and a child cannot
   * resize its sibling. The chart is flex-1 and simply takes what is left.
   */
  const [lowerH, setLowerH] = useState(150);
  const dragging = useRef(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  /* Bumped to reframe the chart from outside it — see PriceChart.resetSignal. */
  const [chartReset, setChartReset] = useState(0);
  /*
   * Sana, folded.
   *
   * Held here rather than inside Sana because folding changes the layout
   * AROUND the bar — the chart panel grows into the space it leaves — and a
   * component cannot resize its own sibling.
   */
  const [sanaFolded, setSanaFolded] = useState(false);
  const [pending, startTransition] = useTransition();

  /*
   * THE OPEN MARKET IS NOW EITHER A BINANCE PAIR OR A SOLANA MINT.
   *
   * The left panel lists the whole chain, so `symbol` stopped being one of
   * fourteen strings the moment a row in Trending became clickable. Every
   * Binance-shaped thing below — the websocket, the book depth, `marketOf` —
   * has to know which it is holding, because `marketOf` does not fail on an
   * unknown key: it returns MARKETS[0], so a mint would silently render as
   * BTC. A chart header naming the wrong coin is the exact class of bug this
   * codebase keeps deciding is unacceptable.
   */
  const onChain = looksLikeMint(symbol);
  const majors = useMajors();
  const token = useTokenInfo(onChain ? symbol : null);

  /* Display identity. For a mint it comes from the token itself; the listed
     Solana markets carry a nicer name, so they win where they exist. */
  const listed = onChain ? marketByMint(symbol) : null;
  const market: MarketDef = onChain
    ? {
        symbol,
        base: listed?.symbol ?? token?.symbol ?? "…",
        name: listed?.name ?? token?.name ?? "",
        /* Supply is a hardcoded table for the Binance majors and has no
           equivalent here. Zero rather than a guess: market cap for an
           on-chain token comes from Jupiter, which reports it directly. */
        supply: 0,
        hue: listed?.hue ?? "#516af6",
        glyph: listed?.glyph ?? (token?.symbol ?? "?").slice(0, 1),
      }
    : marketOf(symbol);

  /*
   * Refetch when the market or the interval changes — but NOT on mount for
   * what the server already fetched.
   *
   * The guard compared against SYMBOL, the Binance pair, and the page now
   * opens on the SOL mint — so it stopped matching and every load refetched
   * candles the server had already sent. Three times, because `initial` was a
   * dependency. Compared against `initialSymbol` it means what it says.
   *
   * `initial` is deliberately NOT a dependency. It is the server's payload for
   * one particular market and interval; re-running this because its identity
   * changed refetches something nobody asked for.
   */
  /*
   * What is already drawn, so the effect can be run twice and do the work
   * once. StrictMode invokes every effect twice in development, which quietly
   * defeats a "have I run before" boolean — the first pass consumes the flag
   * and the second pass does the thing the flag existed to prevent. Keying on
   * the market instead is idempotent: running it ten times fetches nothing new.
   */
  const loaded = useRef(`${initialSymbol}|${initialInterval}`);

  useEffect(() => {
    const key = `${symbol}|${interval}`;
    /* Already on screen. `initial.length` is the escape hatch: a failed server
       render leaves nothing to show, and then the client must go and get it. */
    if (loaded.current === key && initial.length > 0) return;

    let alive = true;
    let attempt = 0;

    const load = async () => {
      try {
        const res = await fetch(`/api/candles?symbol=${symbol}&interval=${interval}`);
        if (!alive) return;
        if (!res.ok) throw new Error(String(res.status));
        const { candles: next } = (await res.json()) as { candles: Candle[] };
        if (!alive) return;

        /*
         * NEVER REPLACE A CHART WITH NOTHING.
         *
         * An empty series means "we could not see", not "this token has no
         * history" — and blanking a drawn chart to say so throws away the only
         * information on screen. A stale chart is readable; an empty one is
         * indistinguishable from a broken app, which is what it looked like.
         *
         * A token that genuinely has no candles starts empty and stays empty,
         * which is correct: there was never anything to lose.
         */
        if (next.length === 0) {
          setCandles((prev) => (prev.length > 0 ? prev : next));
          if (retry()) return;
          return;
        }
        setCandles(next);
        loaded.current = key;
      } catch {
        /* Keep whatever is drawn and try again. The upstreams here fail
           transiently — a 429 from GeckoTerminal's free tier, a DNS blip —
           and both are gone by the next attempt. */
        retry();
      }
    };

    /** Up to three goes, backing off. Returns false once they are spent. */
    function retry(): boolean {
      if (!alive || attempt >= 3) return false;
      const wait = [600, 1800, 4000][attempt];
      attempt += 1;
      window.setTimeout(() => {
        if (alive) void load();
      }, wait);
      return true;
    }

    startTransition(() => {
      void load();
    });

    return () => {
      alive = false;
    };
    // `initial` is intentionally absent — see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, interval, initialSymbol, initialInterval]);

  /*
   * Drop the live price the moment the market changes.
   *
   * Without this, BTC's $78,000 stays in `live` until the first SOL tick
   * arrives — and `live` is what the ticket prices a buy at. For a few hundred
   * milliseconds after every row click, the buy button would size a position
   * off the previous market's price.
   */
  useEffect(() => setLive(undefined), [symbol]);

  /*
   * Live bars pushed over a websocket — BINANCE ONLY.
   *
   * There is no equivalent for a Solana token without an RPC provider's pool
   * subscription, so an on-chain market's price arrives from the /api/prices
   * poll instead: seconds rather than a tick. That is the honest ceiling, and
   * it is the one place Helius would actually buy something.
   *
   * Subscribing with a mint would open a socket to a Binance stream that does
   * not exist and reconnect against it forever.
   */
  useEffect(() => {
    if (onChain) return;
    return subscribeCandles(interval, (c) => setLive(c.close), symbol);
  }, [interval, symbol, onChain]);

  /*
   * An on-chain market's live price, FROM THE SHARED FEED.
   *
   * This used to run its own five-second poll. It got the right number and
   * the market list got a different right number, because the list carried
   * whatever price arrived with the token feed — so SOL read $100.77 in the
   * header and $100.74 in the row beside it. Both components read one object
   * now, so they move together or not at all.
   */
  const openMarks = useSolPrices("open-market", onChain ? [symbol] : []);
  const openMark = onChain ? (openMarks[symbol] ?? null) : null;

  useEffect(() => {
    if (openMark) setLive(openMark.usd);
  }, [openMark]);

  /*
   * The drag itself, on the WINDOW rather than the handle.
   *
   * A pointer moving faster than React re-renders leaves the handle behind,
   * and a handler bound to the handle stops receiving events the moment the
   * cursor is outside it — the panel then sticks mid-drag. Listening on the
   * window for as long as the drag lasts is what makes it track properly.
   */
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragging.current || !bodyRef.current) return;
      const bottom = bodyRef.current.getBoundingClientRect().bottom;
      // Floors and ceilings, or the chart can be dragged out of existence and
      // the divider becomes unreachable.
      setLowerH(Math.max(64, Math.min(bottom - e.clientY, 460)));
    };
    const onUp = () => {
      dragging.current = false;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  const startDrag = useCallback(() => {
    dragging.current = true;
    // Without these the drag selects the table text under the cursor and the
    // cursor flickers back to the arrow whenever it leaves the handle.
    document.body.style.userSelect = "none";
    document.body.style.cursor = "row-resize";
  }, []);

  /* Book depth for the Liquidity reading. Polled slowly — it is a context
     number, not something anyone trades off tick by tick. */
  useEffect(() => {
    let alive = true;
    /*
     * AN AMM HAS NO ORDER BOOK, so there is nothing to ask for here on a
     * Solana market. The equivalent question is price impact at size, which
     * /api/quote already answers — a different reading rather than the same
     * one from another source, and a change to make deliberately rather than
     * by quietly substituting a number that means something else.
     */
    if (onChain) {
      setDepth(null);
      return;
    }
    const load = async () => {
      try {
        const res = await fetch(`/api/depth?symbol=${symbol}`);
        if (!res.ok) return;
        const { depthUsd } = (await res.json()) as { depthUsd: number };
        if (alive) setDepth(depthUsd);
      } catch {
        /* Keep the last reading rather than blanking the box. */
      }
    };
    setDepth(null);
    void load();
    const id = window.setInterval(load, 20_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [symbol]);

  const last = live ?? candles[candles.length - 1]?.close;

  /*
   * Prices for every market, for rules on markets nobody is looking at.
   *
   * The websocket only carries the open market. A stop armed on BTC while the
   * user watches SOL would otherwise never be checked — so the poll that fills
   * the left panel doubles as the feed for everything else. Coarser, and
   * honest about it; the server worker is what makes it uniform.
   *
   * Memoised because it is a dependency of the engine's tick, and a fresh
   * object every render would re-run the tick on every render.
   */
  const prices = useMemo(
    () => Object.fromEntries(majors.map((m) => [m.id, m.priceUsd])),
    [majors],
  );

  /*
   * THE POSITION IS SOL, WHATEVER MARKET IS OPEN.
   *
   * The account panel and the header bag were marked at `last` — the price of
   * whatever chart you happen to be looking at. Open BTC while holding SOL and
   * the same four SOL were valued at $77,000 each: the bag read $312,708 and
   * open P&L read +75,295%. Nothing was wrong with the ledger; the number
   * shown against it was simply another market's price.
   *
   * A screen that tells someone they are up seventy-five thousand percent is
   * the worst kind of false — it is specific, confident, and in the direction
   * people want to believe. Marking uses SOL's own price, from the poll,
   * falling back to the live tick only when SOL is the open market.
   *
   * cipher: the paper ledger holds one asset. When it holds many, this becomes
   * a price-by-mint lookup and the fallback disappears.
   */
  /*
   * THE ENGINE KEYS ON MINTS, the chart keys on Binance pairs.
   *
   * Translated here, at the single point where a market key crosses into the
   * trigger engine, rather than anywhere downstream — a rule written with
   * "SOLUSDT" in its market column is a rule the worker asks Jupiter about by
   * that name, gets no price for, and skips forever.
   *
   * A market with no Solana listing keeps its pair and stays chart-only. That
   * is honest rather than lazy: the ledger holds one asset today, so BTC is
   * something to look at and not something to hold, and a mint invented for it
   * would be a promise nothing can keep.
   */
  const triggerMarket = useMemo(() => mintFor(symbol) ?? symbol, [symbol]);
  const triggerPrices = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [pair, price] of Object.entries(prices)) out[mintFor(pair) ?? pair] = price;
    return out;
  }, [prices]);

  const solPrice = prices["SOLUSDT"] ?? (symbol === "SOLUSDT" ? last : undefined);

  /* Cap for the open market, from the same supply table the list uses — so
     the header and the row a click arrived from cannot disagree. */
  /*
   * Cap comes from the supply table for a Binance pair and from Jupiter for a
   * mint. Never price × 0, which is what the table would give for a token it
   * has never heard of — a market cap of exactly zero printed with confidence.
   */
  const marketCap = onChain
    ? (token?.mcap ?? null)
    : last
      ? last * market.supply
      : null;

  /*
   * A real 24-hour change, found by walking back to the bar closest to 24h
   * ago rather than using candles[0].
   *
   * The first loaded bar is not "24h ago" on any interval: 1000 hourly
   * candles is six weeks. Measuring from it and labelling the result "1H"
   * printed +39.92% on a day SOL had barely moved — a number that looks
   * authoritative and is simply false.
   *
   * Returns null when the loaded window is shorter than a day (1m bars cover
   * about 16 hours), because "we cannot see that far back" is a different
   * statement from "it did not move".
   */
  const DAY = 86_400;
  const cutoff = candles.length ? candles[candles.length - 1].time - DAY : 0;
  const dayAgo = candles.find((c) => c.time >= cutoff);
  const spansDay = Boolean(dayAgo && candles[0].time <= cutoff);
  /*
   * ON-CHAIN: the change that came with the price. Anything else is a THIRD
   * number for the same coin — the header derived it by walking the candle
   * series back 24h while the row showed Jupiter's own figure, so SOL was down
   * 1.65% in one place and 1.28% in the other. Same response, same moment,
   * same number.
   *
   * For a Binance pair the candle walk stays: it is the only source there, and
   * it is honest about refusing when the loaded window is shorter than a day.
   */
  const change = onChain
    ? (openMark?.change24h ?? null)
    : spansDay && dayAgo && last
      ? ((last - dayAgo.open) / dayAgo.open) * 100
      : null;

  /* Traded volume over the same 24h, priced in dollars. The raw figure on a
     candle is base units — SOL, not USD — and printing it with a dollar sign
     read as a 69-cent market. */
  const dayVolumeUsd = spansDay
    ? candles
        .filter((c) => c.time >= cutoff)
        .reduce((sum, c) => sum + c.volume * c.close, 0)
    : null;

  return (
    /*
     * The engine sits inside the account and outside the UI.
     *
     * Inside, because a fired rule has to move the same balance the ticket
     * moves. Outside the layout, because the alerts panel, the ticket and
     * Sana all read armed rules, and a provider below any of them would mean
     * lifting state back up the first time a second one needed it.
     */
    <TriggerProvider live={live ?? null} market={triggerMarket} prices={triggerPrices}>
    {/*
     * EXACTLY THREE SCROLLBARS, one per column, and none at the browser edge.
     *
     * The shell is the viewport again. A document that grows past the screen
     * gets a fourth bar at the browser's own edge, which is the one thing this
     * layout must not have — the header and the ticker are meant to be fixed
     * points, and the three columns are meant to move independently.
     */}
    <div className="relative flex h-dvh flex-col gap-2 overflow-hidden bg-ink p-2">
      {/* ---------------- header ---------------- */}
      {/*
        * Sticky, and wrapped.
        *
        * The wrapper is what sticks, not the bar — and it carries the page's
        * own background and padding, bled out past the shell with -mx-2/-mt-2.
        * Sticking the bar itself at top-2 left an eight-pixel sliver of the
        * shell's padding above it, and the content scrolled up THROUGH that
        * gap: a moving stripe of candles above a header that was supposed to
        * be covering them.
        */}
      <header className="flex shrink-0 items-center gap-3 rounded-2xl border border-line bg-panel px-3 py-2">
        <a href="/" className="shrink-0 font-display text-xl lowercase text-champagne">
          cipher
        </a>
        <span className="shrink-0 rotate-[-6deg] rounded bg-accent px-1.5 py-0.5 font-sans text-[8.5px] font-extrabold uppercase tracking-[0.08em] text-ink">
          beta
        </span>

        {/* Centred, and the widest thing in the row. On a platform with more
            markets than fit a list, search is the primary navigation. */}
        <MarketSearch onSelect={setSymbol} />

        <span className="shrink-0 rounded-full border border-accent/40 bg-accent/10 px-2.5 py-1 font-sans text-[9px] font-extrabold uppercase tracking-[0.1em] text-accent">
          Paper money
        </span>

        <Bag marks={triggerPrices} />

        {/* Was a hardcoded "AR" — a placeholder indistinguishable from a
            working account menu, which is the worst kind. */}
        <AccountMenu />
      </header>

      {/* ---------------- body ---------------- */}
      <div
        ref={bodyRef}
        className="grid min-h-0 flex-1 gap-2"
        // Grid template in a style rather than a class: the left column has to
        // collapse to zero when the panel is closed, and Tailwind cannot hold
        // a conditional arbitrary value without generating both classes.
        /*
         * PERCENTAGES, not pixels, and they are fomo's own proportions.
         *
         * Measured off their page at 1920: the market list is ~496px and the
         * ticket column ~464px, so 26% and 24%. cipher was 248px and 320px —
         * 16% and 21% — which is why the left panel felt cramped beside
         * theirs even though the rows were the same height.
         *
         * Kept as percentages because fomo's absolute widths are designed for
         * 1920 and would leave under 600px of chart on a 1536 laptop. These
         * land on their exact pixel widths at 1920 and stay proportional below
         * it.
         */
        /*
         * TWO columns now, not three: the market list, and everything else.
         *
         * Everything else scrolls as ONE region under a single bar on the far
         * right — chart, prompt bar, fills, ticket and flow all move together.
         * The market list does not, because it is how you navigate: scrolling
         * it away to read a ticket is losing the thing you steer with.
         */
        style={{ gridTemplateColumns: panelOpen ? "26% minmax(0,1fr)" : "minmax(0,1fr)" }}
      >
        {panelOpen && (
          <div className="hidden min-h-0 lg:flex lg:flex-col">
            <SidePanel
              majors={majors}
              symbol={symbol}
              onSelect={setSymbol}
              split={split}
              onSplit={setSplit}
              onCollapse={() => setPanelOpen(false)}
            />
          </div>
        )}

        {/* Reopening it. A collapse with no way back is a trap, and fomo's
            chevron is the only affordance once the panel is gone. */}
        {!panelOpen && (
          <button
            onClick={() => setPanelOpen(true)}
            aria-label="Open panel"
            className="absolute left-2 top-1/2 z-20 hidden -translate-y-1/2 rounded-r-lg border border-l-0 border-line bg-panel px-1 py-3 font-mono text-[13px] text-mute hover:text-champagne lg:block"
          >
            »
          </button>
        )}

        {/*
          * THE SCROLLING REGION. One bar, far right, 144px.
          *
          * Its children are a grid rather than a flex row so the chart and the
          * ticket keep their proportions while the whole thing moves. 32% of
          * this region is 24% of the viewport, which is the width the ticket
          * column had when it was a top-level grid column.
          */}
        <Scroller className="min-h-0" barHeight={144}>
          <div
            className="grid gap-2 pr-2.5"
            style={{ gridTemplateColumns: "minmax(0,1fr) 32%" }}
          >

        {/*
          * The chart column, with Sana beneath it.
          *
          * Sana used to float over the whole shell, which meant it had no
          * column to belong to: it was centred on the PAGE, so it sat off
          * centre against the chart, and the fills table had to carry a 104px
          * margin to stay out from under it.
          *
          * Inside the column it is simply the last row — bounded by the same
          * width as the chart, and nothing is underneath anything.
          */}
        {/*
          * The chart column does NOT scroll. Two bars, not three.
          *
          * Which means everything in it has to FIT, and the chart is what
          * absorbs the difference: the prompt bar and the fills table keep
          * their heights and the chart takes whatever is left. That is the
          * right way round anyway — the table is a fixed number of rows and
          * the prompt bar is one line, while a chart stays legible at any
          * height above a floor.
          */}
        <div className="relative flex flex-col gap-2">
        <section className="relative flex flex-col overflow-hidden rounded-2xl border border-line bg-panel">
          <ChartHeader
            market={market}
            icon={token?.icon ?? null}
            price={last}
            marketCap={marketCap}
            change={change}
            volumeUsd={dayVolumeUsd}
            depthUsd={depth}
            interval={interval}
            onInterval={setInterval}
            pending={pending}
          />

          {/*
            * A real height again. The column no longer fills the viewport —
            * it is content inside a scrolling region — so there is nothing for
            * flex-1 to take a share of.
            *
            * data-wheel-lock: the chart owns the wheel over itself. Without it
            * a zoom also scrolled the region, so the candles came closer and
            * the whole column slid at the same time. See Scroller.
            */}
          <div data-wheel-lock className="h-[55vh] min-h-[320px]">
            <PriceChart
                resetSignal={chartReset}
              candles={candles}
              livePrice={live}
              barSeconds={intervalSeconds(interval)}
            />
          </div>

          {/*
            * THE MARK OVERLAYS. It takes no layout space at all.
            *
            * It used to be a centred row of its own, so folding the bar
            * swapped a 90px block for a 60px one rather than removing it — a
            * gap where the bar had been, with a dot floating in it. Absolute,
            * so the chart and the table close right up and the mark sits on
            * whatever happens to be underneath.
            *
            * At the bottom edge of the chart because that is exactly where the
            * bar collapses from: clicking it expands in place rather than
            * making the page jump to somewhere the mark was not.
            *
            * pointer-events-none on the layer, or the full-width strip either
            * side of the mark would steal clicks from the candles behind it.
            * Auto back on for the mark itself.
            */}
          {/*
            * ALWAYS RENDERED, scaled to nothing when the bar is open.
            *
            * Mounting it on fold would pop it in at full size with no way to
            * animate the arrival — an element cannot transition from not
            * existing. It is absolute either way, so keeping it costs no
            * layout.
            *
            * Delays mirror the bar's: appearing waits for the bar to be mostly
            * gone, disappearing goes first.
            */}
          <div
            aria-hidden={!sanaFolded}
            className={`pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center transition-all duration-300 ease-out ${
              sanaFolded
                ? "scale-100 opacity-100 delay-[120ms]"
                : "scale-50 opacity-0"
            }`}
          >
            <div className={sanaFolded ? "pointer-events-auto" : ""}>
              <SanaMark onOpen={() => setSanaFolded(false)} />
            </div>
          </div>
        </section>

        {/*
          * SANA SITS BETWEEN THE CHART AND THE TABLE.
          *
          * It was the last thing in the column, under the fills — which put the
          * primary input of the product below a table you scroll past to reach
          * it. On fomo the equivalent row sits immediately under the chart.
          *
          * It is also simply where the eye already is: you read the chart, you
          * form an intent, and the place to say it is the next thing down.
          */}
        {/*
          * grid-rows 1fr -> 0fr, NOT max-height.
          *
          * A max-height transition animates a number the content never
          * reaches: going 70vh to 0, nothing visibly moves until the value
          * drops below the bar's real height, so the first two thirds of the
          * animation are dead time and the rest is a snap. Rows in fr units
          * animate the CONTENT's own height, so the whole 300ms is motion.
          *
          * Opening waits 120ms for the mark to get out of the way; closing
          * starts immediately so the bar is already shrinking as the mark
          * arrives. Without the stagger the two cross in the middle and there
          * is a frame with both of them at half strength.
          */}
        <div
          className={`grid shrink-0 transition-all duration-300 ease-out ${
            sanaFolded
              ? "-mb-2 grid-rows-[0fr] opacity-0"
              : "grid-rows-[1fr] opacity-100 delay-[120ms]"
          }`}
          aria-hidden={sanaFolded}
        >
          <div className="overflow-hidden">
            <Sana
              price={last}
              market={market.base}
              symbol={symbol}
              interval={interval}
              majors={majors}
              /* The terminal owns the market, the interval and the layout, so
                 Sana asks rather than sets — a component cannot change its
                 parent's state, and "show me BTC on the daily" has to work. */
              onNavigate={(to) => {
                if (to.symbol) setSymbol(to.symbol);
                if (to.interval) setInterval(to.interval);
                if (to.panel) setPanelOpen(true);
              }}
              onUi={(action) => {
                if (action === "collapsePanel") setPanelOpen(false);
                else if (action === "expandPanel") setPanelOpen(true);
                else if (action === "splitBottom") setSplit("bottom");
                else if (action === "splitRight") setSplit("right");
                else if (action === "resetChart") setChartReset((n) => n + 1);
              }}
              depthUsd={depth}
              onCollapse={() => setSanaFolded(true)}
            />
          </div>
        </div>

        {/* "Split right" gives the chart the whole column. */}
        {split === "bottom" && (
          <section className="flex shrink-0 flex-col overflow-hidden rounded-2xl border border-line bg-panel">
            {/*
              * The divider.
              *
              * touch-none because a pointerdown on a scrollable panel is a
              * scroll gesture on touch devices — without it the browser claims
              * the pointer and the drag never starts.
              */}
            <div
              onPointerDown={startDrag}
              onDoubleClick={() => setLowerH(150)}
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize trade history"
              title="Drag to resize · double-click to reset"
              className="group flex h-2 shrink-0 cursor-row-resize touch-none items-center justify-center transition-colors hover:bg-raised"
            >
              <span className="h-[3px] w-8 rounded-full bg-line transition-colors group-hover:bg-ash" />
            </div>
            <div style={{ height: lowerH }} className="shrink-0 overflow-hidden">
              <MyTrades />
            </div>
          </section>
        )}
        </div>

        {/*
          * ONE SCROLLER FOR THE WHOLE COLUMN, with its bar at the far right.
          *
          * The ticket used to scroll inside itself while Flow sat pinned below
          * it — two independent scroll regions stacked, and the bar appeared in
          * the middle of the page against the ticket's inner edge rather than
          * at the edge of the screen. fomo scrolls the entire right column as
          * one: ticket, then panels, then positions, one bar at the rightmost
          * end.
          *
          * This is the exact inverse of the arrangement that broke before, so
          * it only works if the CHILDREN stop being flexible. Ticket is now
          * shrink-0 at its natural height; if it ever goes back to flex-1 with
          * its own overflow, flexbox will compress it and its internal
          * overflow will clip the account panel mid-row again.
          */}
        {/* No scroller of its own any more — it moves with the region. */}
        <aside className="flex flex-col [&>*]:shrink-0">
          <Ticket price={last} solPrice={solPrice} symbol={symbol} market={market.base} depthUsd={depth} />
          <Flow candles={candles} last={last} />
        </aside>
          </div>
        </Scroller>
      </div>

      {/* Sticky to the bottom for the same reason the header is sticky to the
          top: it is the only thing on the page saying what the rest of the
          market is doing. */}
      <StatusBar majors={majors} onSelect={setSymbol} />
    </div>
    </TriggerProvider>
  );
}

/**
 * The balance in the header. CASH AND TOTAL, never total alone.
 *
 * Total account value is the number a trader glances at, but it is the wrong
 * number to show by itself the moment after a buy: dollars turn into SOL, so
 * a $250 purchase moves it by the fee and nothing else. Shipped that way it
 * read as "the buy did not register", and the honest response to that is to
 * press buy again — which is exactly what happened, six times, for $1,507.
 *
 * Cash is the number that answers "did that come out of my account". It goes
 * first, and it moves by the full amount.
 *
 * Both render "—" until the account is read out of storage. The server always
 * renders the opening deposit, and flashing $10,000 before correcting to the
 * real figure is, for one frame, the screen telling someone they have money
 * they do not have.
 */
function Bag({ marks }: { marks: Record<string, number> }) {
  const { account, hydrated, reset } = usePaperAccount();
  /*
   * Resetting the account must also disarm everything.
   *
   * A rule references a position by percentage, and the reset it survives is a
   * rule watching for a position that no longer exists. It would fire, find
   * nothing, and cancel itself — harmless but bewildering, and the alerts
   * panel would carry stops for a balance that had been wiped. The two pieces
   * of state are one decision, so they clear together.
   */
  const { clearAll } = useTriggers();
  const [confirming, setConfirming] = useState(false);

  /*
   * MARKED PER MINT, not against whatever chart is open.
   *
   * This took a single `price` — the price of the market being looked at —
   * and multiplied the whole position by it. With one asset that was merely
   * fragile; with many it is nonsense. The previous version of this exact bug
   * valued four SOL at BTC's price and printed a bag of $312,708 and +75,295%.
   *
   * Holdings with no mark are skipped rather than counted as zero, so a slow
   * price request does not look like the money vanishing.
   */
  const held = heldMints(account);
  const priced = held.some((m) => marks[m] !== undefined);
  const value = hydrated && (held.length === 0 || priced) ? equity(account, marks) : null;
  const ret = value === null ? null : ((value - account.depositedUsd) / account.depositedUsd) * 100;

  return (
    <div className="flex items-center gap-3">
      <div className="hidden text-right sm:block">
        <div className="font-sans text-[9.5px] font-bold uppercase tracking-[0.11em] text-ash">
          Cash
        </div>
        <div className="font-mono text-[13px] font-bold tabular-nums">
          {hydrated ? usd(account.usdc) : "—"}
        </div>
      </div>

      {/* Holdings, so the money that left cash is visibly somewhere rather
          than just gone. Hidden when flat — an empty row is noise.

          The VALUE of everything held rather than a quantity of one coin: a
          quantity means nothing once there are several, and "4.9280" with no
          unit beside it is worse than nothing. */}
      {hydrated && held.length > 0 && (
        <div className="hidden text-right md:block">
          <div className="font-sans text-[9.5px] font-bold uppercase tracking-[0.11em] text-ash">
            {held.length === 1 ? "Holding" : `${held.length} coins`}
          </div>
          <div className="font-mono text-[13px] font-bold tabular-nums">
            {value === null ? "—" : usd(value - account.usdc)}
          </div>
        </div>
      )}

      <div className="hidden border-l border-line pl-3 text-right sm:block">
        <div className="font-sans text-[9.5px] font-bold uppercase tracking-[0.11em] text-ash">
          Bag
        </div>
        <div className="font-mono text-[13px] font-bold tabular-nums">
          {value === null ? "—" : usd(value)}
          {ret !== null && (
            <span className={`ml-1.5 text-[11px] ${ret >= 0 ? "text-up" : "text-down"}`}>
              {pct(ret, false)}
            </span>
          )}
        </div>
      </div>

      {/* Two taps to wipe the account. One tap would be a $10,000 reset next to
          a live P&L, which people would hit by accident exactly once. */}
      <button
        onClick={() => {
          if (!confirming) {
            setConfirming(true);
            window.setTimeout(() => setConfirming(false), 4000);
            return;
          }
          reset();
          clearAll();
          setConfirming(false);
        }}
        className={`rounded-lg border px-2 py-1 font-sans text-[9.5px] font-bold uppercase tracking-[0.08em] transition-colors ${
          confirming
            ? "border-down bg-down/15 text-down"
            : "border-line text-ash hover:text-champagne"
        }`}
      >
        {confirming ? `Wipe to $${OPENING_DEPOSIT / 1000}k?` : "Reset"}
      </button>
    </div>
  );
}
