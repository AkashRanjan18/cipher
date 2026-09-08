"use client";

import { useEffect, useState, useTransition } from "react";
import type { Candle, Interval } from "@/lib/market";
import {
  SYMBOL,
  INTERVAL_ORDER,
  intervalSeconds,
  subscribeCandles,
} from "@/lib/market";
import { usd, pct, compactUsd } from "@/lib/format";
import { PaperAccountProvider, usePaperAccount, OPENING_DEPOSIT } from "@/lib/account/store";
import { equity } from "@/lib/account/paper";
import { STRIP_ITEMS } from "@/lib/social/mock";
import { PriceChart } from "./price-chart";
import { Rail } from "./rail";
import { LowerTabs } from "./lower-tabs";
import { Ticket } from "./ticket";
import { Polly } from "./polly";

/**
 * The terminal shell.
 *
 * Layout is Parrot's: header, then a three-column body (flock rail, chart with
 * a panel under it, ticket), then a social strip, then Polly along the bottom.
 * That arrangement is why the design works — the social layer is never a tab
 * you go to, it sits beside the chart the whole time.
 *
 * Two departures from the source. Parrot's market switcher and watchlist are
 * gone, because cipher runs one market and a selector with one option is a
 * control that does nothing. And the chart stays lightweight-charts rather
 * than Parrot's hand-rolled canvas — it already carries real candles, a live
 * websocket, zoom, pan and a crosshair, none of which the canvas version has.
 *
 * This component owns the three things that change without a navigation: the
 * interval, the candle set, and the live price. Everything else is a child.
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
  const [interval, setInterval] = useState<Interval>(initialInterval);
  const [candles, setCandles] = useState<Candle[]>(initial);
  const [live, setLive] = useState<number | undefined>(undefined);
  const [pending, startTransition] = useTransition();

  /*
   * Refetch on interval change — but not on mount, because the server already
   * fetched this exact set and refetching would blank the chart for one round
   * trip on every page load.
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

  // Live bars pushed over a websocket. Resubscribes per interval.
  useEffect(() => subscribeCandles(interval, (c) => setLive(c.close)), [interval]);

  const last = live ?? candles[candles.length - 1]?.close;

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
    <div className="flex h-dvh flex-col gap-2 overflow-hidden bg-ink p-2">
      {/* ---------------- header ---------------- */}
      <header className="flex shrink-0 items-center gap-3 rounded-2xl border border-line bg-panel px-3 py-2">
        <a href="/" className="font-display text-xl lowercase text-champagne">
          cipher
        </a>
        <span className="rotate-[-6deg] rounded bg-accent px-1.5 py-0.5 font-sans text-[8.5px] font-extrabold uppercase tracking-[0.08em] text-ink">
          beta
        </span>

        <span className="ml-auto rounded-full border border-accent/40 bg-accent/10 px-2.5 py-1 font-sans text-[9px] font-extrabold uppercase tracking-[0.1em] text-accent">
          Paper money
        </span>

        <Bag price={last} />

        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent font-sans text-[11px] font-extrabold text-ink">
          AR
        </div>
      </header>

      {/* ---------------- body ---------------- */}
      <div className="grid min-h-0 flex-1 gap-2 lg:grid-cols-[248px_minmax(0,1fr)_320px]">
        <div className="hidden min-h-0 lg:flex lg:flex-col">
          <Rail />
        </div>

        <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-line bg-panel">
          {/* instrument head */}
          <div className="flex flex-wrap items-center gap-3 border-b border-hairline px-3.5 py-2.5">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent font-display text-lg font-bold text-ink">
              ◎
            </span>
            <div>
              <h1 className="font-display text-[22px] font-bold leading-tight tracking-tight">
                SOL
              </h1>
              <p className="font-sans text-[11px] text-ash">
                Solana · Binance · {SYMBOL}
              </p>
            </div>

            <div className="ml-auto flex flex-wrap items-center gap-1.5">
              {[
                ["Price", last ? usd(last) : "—"],
                ["24h", change === null ? "—" : pct(change, false)],
                ["24h vol", compactUsd(dayVolumeUsd)],
                ["Bars", String(candles.length)],
              ].map(([k, v], i) => (
                <div
                  key={k}
                  className="flex min-w-[76px] flex-col gap-0.5 rounded-xl border border-hairline bg-slate px-3 py-1.5"
                >
                  <span className="font-sans text-[9.5px] font-bold uppercase tracking-[0.11em] text-ash">
                    {k}
                  </span>
                  <span
                    className={`font-mono text-[13px] font-bold tabular-nums ${
                      i === 1 && change !== null
                        ? change >= 0
                          ? "text-up"
                          : "text-down"
                        : ""
                    }`}
                  >
                    {v}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* timeframe */}
          <div className="flex shrink-0 items-center gap-2 border-b border-hairline px-3.5 py-2">
            <div className="flex gap-0.5 rounded-full bg-slate p-1">
              {INTERVAL_ORDER.map((i) => (
                <button
                  key={i}
                  onClick={() => setInterval(i)}
                  aria-pressed={i === interval}
                  className={`rounded-full px-2.5 py-1 font-mono text-[10.5px] transition-colors ${
                    i === interval ? "bg-raised text-champagne" : "text-ash hover:text-champagne"
                  }`}
                >
                  {i}
                </button>
              ))}
            </div>
            {pending && <span className="font-mono text-[10.5px] text-ash">loading…</span>}
            <span className="ml-auto font-mono text-[10.5px] text-ash">
              live from Binance
            </span>
          </div>

          <div className="min-h-[180px] flex-1">
            <PriceChart
              candles={candles}
              livePrice={live}
              barSeconds={intervalSeconds(interval)}
            />
          </div>

          <div className="h-[210px] shrink-0">
            <LowerTabs />
          </div>
        </section>

        <aside className="flex min-h-0 flex-col">
          <Ticket price={last} />
        </aside>
      </div>

      {/* ---------------- social strip ---------------- */}
      <div className="no-scrollbar flex h-8 shrink-0 items-center overflow-x-auto rounded-xl border border-line bg-panel">
        {STRIP_ITEMS.map((html) => (
          <span
            key={html}
            className="whitespace-nowrap border-r border-hairline px-3.5 font-sans text-[11.5px] text-ash [&_b]:font-bold [&_b]:text-champagne"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ))}
      </div>

      <Polly price={last} />
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
