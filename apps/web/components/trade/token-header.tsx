"use client";

import { useEffect, useRef, useState } from "react";
import { useLive } from "./live-price";

/**
 * The terminal's top strip: identity, then the stats as one dense row.
 *
 * A client component, because these are the numbers that move. It reads the
 * shared poll from <LivePrice> rather than fetching, so the header and the
 * chart cost one request between them instead of two.
 *
 * Shape matters here. On a terminal this bar is glanced at, not read: it has
 * to stay one line deep so the chart keeps the vertical space. That is why
 * the stats are inline labels rather than the stacked cards a marketing page
 * would use.
 */

/**
 * Memecoin prices run to 3e-6 and market caps to nine figures, so one
 * formatter cannot serve both.
 */
function money(n: number | null): string {
  if (n === null) return "—";
  if (n === 0) return "$0";
  if (n >= 1_000) {
    return `$${new Intl.NumberFormat("en-US", {
      notation: "compact",
      maximumFractionDigits: 2,
    }).format(n)}`;
  }
  if (n >= 1) return `$${n.toFixed(2)}`;
  // Below a dollar, decimal places are meaningless — significant digits are
  // what tells you 0.0000030 from 0.0000003.
  return `$${n.toPrecision(3)}`;
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "up" | "down";
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="font-mono text-[10px] tracking-[0.12em] text-ash">
        {label}
      </span>
      <span
        className={`font-mono text-xs tabular-nums ${
          tone === "up"
            ? "text-green-400"
            : tone === "down"
              ? "text-red-400"
              : "text-champagne"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * The price, flashing on change.
 *
 * The flash is not decoration. On a static number a trader cannot tell a
 * quiet market from a broken feed; the flash is the proof the feed is alive,
 * which is exactly what the staleness dot next to it withdraws when it isn't.
 */
function LivePriceCell({ price, fresh }: { price: number; fresh: boolean }) {
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  const prev = useRef(price);

  useEffect(() => {
    if (price === prev.current) return;
    setFlash(price > prev.current ? "up" : "down");
    prev.current = price;
    const id = setTimeout(() => setFlash(null), 600);
    return () => clearTimeout(id);
  }, [price]);

  return (
    <div className="flex items-baseline gap-1.5">
      <span className="font-mono text-[10px] tracking-[0.12em] text-ash">
        PRICE
      </span>
      <span
        className={`rounded px-1 font-mono text-xs tabular-nums transition-colors duration-500 ${
          flash === "up"
            ? "bg-green-400/25 text-green-300"
            : flash === "down"
              ? "bg-red-400/25 text-red-300"
              : "text-champagne"
        }`}
      >
        {money(price)}
      </span>
      {/* Absence of the dot is the "live" signal; its presence means the last
          poll failed and the number beside it is the last one we trusted. */}
      {!fresh && (
        <span
          title="price feed stale — showing last known"
          className="h-1.5 w-1.5 rounded-full bg-amber-400/80"
        />
      )}
    </div>
  );
}

export function TokenHeader() {
  const { stats, fresh } = useLive();
  const up = stats.change24h >= 0;
  const total = stats.buys24h + stats.sells24h;
  // Guard the divide: a brand-new pool has no transactions at all.
  const buyShare = total > 0 ? (stats.buys24h / total) * 100 : 50;

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
      <div className="flex items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element --
            next/image would need every token CDN in next.config, and the
            hosts are whatever DexScreener happens to use per token. */}
        {stats.imageUrl && (
          <img
            src={stats.imageUrl}
            alt=""
            className="h-7 w-7 rounded-full border border-champagne/15 object-cover"
          />
        )}
        <h1 className="font-display text-2xl lowercase leading-none text-champagne">
          {stats.symbol}
        </h1>
        {/* Many tokens report an identical symbol and name; printing both
            then reads as a bug. */}
        {stats.name.toLowerCase() !== stats.symbol.toLowerCase() && (
          <span className="font-sans text-xs text-ash">{stats.name}</span>
        )}
        <span className="rounded border border-champagne/15 px-1.5 py-0.5 font-mono text-[9px] uppercase text-ash">
          {stats.dex}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <LivePriceCell price={stats.priceUsd} fresh={fresh} />
        <Stat
          label="24H"
          value={`${up ? "+" : ""}${stats.change24h.toFixed(2)}%`}
          tone={up ? "up" : "down"}
        />
        <Stat label="MCAP" value={money(stats.marketCap)} />
        <Stat label="VOL" value={money(stats.volume24h)} />
        <Stat label="LIQ" value={money(stats.liquidityUsd)} />
      </div>

      {/*
        Buy/sell pressure. A bar rather than two numbers because the ratio is
        the information — 5,337 and 7,403 mean nothing until you see that
        sells are winning. ml-auto pins it right so it does not shove the
        stats around when the counts change width.
      */}
      <div className="ml-auto flex w-40 flex-col gap-1">
        <div className="flex justify-between font-mono text-[10px] tabular-nums">
          <span className="text-green-400">{stats.buys24h.toLocaleString()}</span>
          <span className="text-red-400">{stats.sells24h.toLocaleString()}</span>
        </div>
        <div className="flex h-1 overflow-hidden rounded-full bg-red-400/40">
          <div
            className="bg-green-400/70"
            style={{ width: `${buyShare}%` }}
            aria-hidden
          />
        </div>
      </div>
    </div>
  );
}
