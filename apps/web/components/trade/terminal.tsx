"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import type { Candle, Interval } from "@/lib/market";
import { SYMBOL, intervalSeconds, subscribeCandles, marketOf } from "@/lib/market";
import { usd, pct } from "@/lib/format";
import { PaperAccountProvider, usePaperAccount, OPENING_DEPOSIT } from "@/lib/account/store";
import { equity } from "@/lib/account/paper";
import { PriceChart } from "./price-chart";
import { SidePanel } from "./side-panel";
import { ChartHeader } from "./chart-header";
import { MarketSearch } from "./market-search";
import { StatusBar } from "./status-bar";
import { useMajors } from "./use-majors";
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
export function Terminal(props: { initial: Candle[]; initialInterval: Interval }) {
  /*
   * The provider wraps the body rather than sitting inside it, because a
   * component cannot consume a context it provides in the same render — and
   * the header needs the balance.
   */
  return (
    <PaperAccountProvider>
      <TerminalBody {...props} />
    </PaperAccountProvider>
  );
}

function TerminalBody({
  initial,
  initialInterval,
}: {
  initial: Candle[];
  initialInterval: Interval;
}) {
  const [symbol, setSymbol] = useState<string>(SYMBOL);
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
  /*
   * Sana, folded.
   *
   * Held here rather than inside Sana because folding changes the layout
   * AROUND the bar — the chart panel grows into the space it leaves — and a
   * component cannot resize its own sibling.
   */
  const [sanaFolded, setSanaFolded] = useState(false);
  const [pending, startTransition] = useTransition();

  const market = marketOf(symbol);
  const majors = useMajors();

  /*
   * Refetch when the market or the interval changes — but not on mount for
   * the pair the server already fetched, because refetching that would blank
   * the chart for one round trip on every page load.
   */
  useEffect(() => {
    if (symbol === SYMBOL && interval === initialInterval) {
      setCandles(initial);
      return;
    }
    let alive = true;
    startTransition(async () => {
      const res = await fetch(`/api/candles?symbol=${symbol}&interval=${interval}`);
      if (!res.ok || !alive) return;
      const { candles: next } = (await res.json()) as { candles: Candle[] };
      if (alive) setCandles(next);
    });
    return () => {
      alive = false;
    };
  }, [symbol, interval, initial, initialInterval]);

  /*
   * Drop the live price the moment the market changes.
   *
   * Without this, BTC's $78,000 stays in `live` until the first SOL tick
   * arrives — and `live` is what the ticket prices a buy at. For a few hundred
   * milliseconds after every row click, the buy button would size a position
   * off the previous market's price.
   */
  useEffect(() => setLive(undefined), [symbol]);

  // Live bars pushed over a websocket. Resubscribes per market and interval.
  useEffect(
    () => subscribeCandles(interval, (c) => setLive(c.close), symbol),
    [interval, symbol],
  );

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
    load();
    const id = window.setInterval(load, 20_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [symbol]);

  const last = live ?? candles[candles.length - 1]?.close;

  /* Cap for the open market, from the same supply table the list uses — so
     the header and the row a click arrived from cannot disagree. */
  const marketCap = last ? last * market.supply : null;

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
  const change =
    spansDay && dayAgo && last ? ((last - dayAgo.open) / dayAgo.open) * 100 : null;

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
     * THE PAGE SCROLLS, the shell does not.
     *
     * This was h-dvh with overflow-hidden: the terminal was pinned to exactly
     * one screen and every panel scrolled inside itself, which put a scrollbar
     * in the middle of the layout for each one. fomo lets the document grow
     * past the viewport and scroll, so there is a single bar at the browser's
     * own edge.
     *
     * min-h-dvh rather than nothing, so a short page still fills the screen
     * instead of leaving the ground colour showing under it.
     */
    <div className="relative flex min-h-dvh flex-col gap-2 bg-ink p-2">
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
      <div className="sticky top-0 z-30 -mx-2 -mt-2 bg-ink px-2 pb-2 pt-2">
        <header className="flex items-center gap-3 rounded-2xl border border-line bg-panel px-3 py-2">
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

        <Bag price={last} />

        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent font-sans text-[11px] font-extrabold text-ink">
          AR
        </div>
        </header>
      </div>

      {/* ---------------- body ---------------- */}
      <div
        ref={bodyRef}
        className="grid gap-2"
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
        style={{
          gridTemplateColumns: panelOpen
            ? "26% minmax(0,1fr) 24%"
            : "minmax(0,1fr) 24%",
        }}
      >
        {panelOpen && (
          <div className="hidden lg:flex lg:flex-col">
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
        <div className="relative flex flex-col gap-2">
        <section className="flex flex-col overflow-hidden rounded-2xl border border-line bg-panel">
          <ChartHeader
            market={market}
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
            * A REAL height, because flex-1 has nothing to fill any more.
            *
            * 55vh with a floor: tall enough to read on a laptop, short enough
            * that what sits under it is visible without scrolling.
            */}
          <div className="h-[55vh] min-h-[320px]">
            <PriceChart
              candles={candles}
              livePrice={live}
              barSeconds={intervalSeconds(interval)}
            />
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
        <div
          className={`overflow-hidden transition-all duration-300 ease-out ${
            sanaFolded ? "-mb-2 max-h-0 opacity-0" : "max-h-[70vh] opacity-100"
          }`}
          aria-hidden={sanaFolded}
        >
          <Sana
            price={last}
            market={market.base}
            depthUsd={depth}
            onCollapse={() => setSanaFolded(true)}
          />
        </div>

        {/* Folded, the mark takes the row instead — centred, in flow. It no
            longer needs to float: the page scrolls and the chart has a fixed
            height, so there is no gap for the panel to grow into. */}
        {sanaFolded && (
          <div className="flex justify-center py-1">
            <SanaMark onOpen={() => setSanaFolded(false)} />
          </div>
        )}

        {/* "Split right" gives the chart the whole column. */}
        {split === "bottom" && (
          <section className="flex flex-col overflow-hidden rounded-2xl border border-line bg-panel">
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
        {/* No overflow here any more: the page scrolls, so this is simply as
            tall as the ticket plus the flow panel. */}
        <aside className="flex flex-col">
          <Ticket price={last} market={market.base} depthUsd={depth} />
          <Flow candles={candles} last={last} />
        </aside>
      </div>

      {/* Sticky to the bottom for the same reason the header is sticky to the
          top: it is the only thing on the page saying what the rest of the
          market is doing. */}
      <div className="sticky bottom-0 z-30 -mx-2 -mb-2 bg-ink px-2 pb-2 pt-2">
        <StatusBar majors={majors} onSelect={setSymbol} />
      </div>
    </div>
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
function Bag({ price }: { price: number | undefined }) {
  const { account, hydrated, reset } = usePaperAccount();
  const [confirming, setConfirming] = useState(false);

  const value = hydrated && price ? equity(account, price) : null;
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
          than just gone. Hidden when flat — an empty row is noise. */}
      {hydrated && account.sol > 0 && (
        <div className="hidden text-right md:block">
          <div className="font-sans text-[9.5px] font-bold uppercase tracking-[0.11em] text-ash">
            SOL
          </div>
          <div className="font-mono text-[13px] font-bold tabular-nums">
            {account.sol.toFixed(4)}
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
