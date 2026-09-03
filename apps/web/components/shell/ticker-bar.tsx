import type { Major } from "@/lib/market";

/**
 * The bottom ticker: blue-chip prices, always visible.
 *
 * Server component — it re-renders when the page does, and the underlying
 * fetch is cached for a minute. Polling it per-second would spend the shared
 * upstream budget to move numbers that move slowly.
 *
 * It is here for orientation, not for trading. SOL in particular sets the
 * tone for every memecoin on the screen: when SOL is down 6%, a token flat on
 * the day is actually strong, and nothing else on the page tells you that.
 */

function price(n: number): string {
  // Majors span $0.0895 (DOGE) to $81,428 (BTC); one fixed precision cannot
  // serve both without either lying or wasting the row.
  if (n >= 1000) return `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toPrecision(3)}`;
}

export function TickerBar({ majors }: { majors: Major[] }) {
  if (majors.length === 0) return null;

  return (
    <div className="flex shrink-0 items-center gap-5 overflow-x-auto border-t border-line bg-ink px-4 py-1.5">
      {majors.map((m) => {
        const up = m.change24h >= 0;
        return (
          <div key={m.id} className="flex shrink-0 items-baseline gap-1.5">
            <span className="font-mono text-[11px] text-ash">{m.symbol}</span>
            <span className="font-mono text-[11px] tabular-nums text-champagne">
              {price(m.priceUsd)}
            </span>
            <span
              className={`font-mono text-[11px] tabular-nums ${
                up ? "text-up" : "text-down"
              }`}
            >
              {up ? "▲" : "▼"}
              {Math.abs(m.change24h).toFixed(2)}%
            </span>
          </div>
        );
      })}
    </div>
  );
}
