import type { TokenStats } from "@/lib/market";

/**
 * Token identity and the stats row.
 *
 * Server component — this is static text derived from data the page already
 * fetched, so it ships no JavaScript.
 */

/**
 * Memecoin prices run to 3e-6 and market caps to nine figures, so one
 * formatter cannot serve both. Compact notation above four figures keeps the
 * row from wrapping; significant digits below one keep a price readable.
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

function Stat({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-[10px] tracking-[0.15em] text-ash">
        {label}
      </span>
      <span
        className={`font-mono text-sm tabular-nums ${
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
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="font-display text-3xl lowercase text-champagne">
          {stats.symbol}
        </h1>
        {/* Many tokens report an identical symbol and name; printing both
            then reads as a bug. */}
        {stats.name.toLowerCase() !== stats.symbol.toLowerCase() && (
          <span className="font-sans text-sm text-ash">{stats.name}</span>
        )}
        <span className="rounded border border-champagne/15 px-1.5 py-0.5 font-mono text-[10px] uppercase text-ash">
          {stats.dex}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-5">
        <Stat label="PRICE" value={money(stats.priceUsd)} />
        <Stat label="MARKET CAP" value={money(stats.marketCap)} />
        <Stat
          label="24H"
          value={`${up ? "+" : ""}${stats.change24h.toFixed(2)}%`}
          tone={up ? "up" : "down"}
        />
        <Stat label="24H VOL" value={money(stats.volume24h)} />
        <Stat label="LIQUIDITY" value={money(stats.liquidityUsd)} />
      </div>

      {/*
        Buy/sell pressure. A bar rather than two numbers because the ratio is
        the information — 5,337 and 7,387 mean nothing until you see that
        sells are winning.
      */}
      <div className="flex flex-col gap-1.5">
        <div className="flex justify-between font-mono text-xs">
          <span className="text-green-400 tabular-nums">
            {stats.buys24h.toLocaleString()} buys
          </span>
          <span className="text-red-400 tabular-nums">
            {stats.sells24h.toLocaleString()} sells
          </span>
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
