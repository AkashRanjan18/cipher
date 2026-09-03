import type { TokenStats } from "@/lib/market";

/**
 * The terminal's top strip: identity, then the stats as one dense row.
 *
 * Server component — static text derived from data the page already fetched,
 * so it ships no JavaScript.
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

export function TokenHeader({ stats }: { stats: TokenStats }) {
  const up = stats.change24h >= 0;
  const total = stats.buys24h + stats.sells24h;
  // Guard the divide: a brand-new pool has no transactions at all.
  const buyShare = total > 0 ? (stats.buys24h / total) * 100 : 50;

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
      <div className="flex items-baseline gap-2">
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
        <Stat label="PRICE" value={money(stats.priceUsd)} />
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
