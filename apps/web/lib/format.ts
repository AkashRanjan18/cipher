/**
 * Number formatting for the terminal.
 *
 * This lived inline in six components, each with its own thresholds, which is
 * why the same token rendered "$1635553.0M" in one panel, "3.165e+4" in
 * another and "0.037843376" in a third. One definition, used everywhere.
 *
 * The hard constraint is range: a single column holds a $0.0000031 memecoin
 * and an $81,000 BTC, and a market-cap axis spans $4k to $1.6T. No fixed
 * precision survives that, and neither does toPrecision — it silently
 * switches to exponent form ("3.165e+4"), which on a trading screen reads as
 * corrupted data rather than a number.
 */

/** Digits needed to show ~4 significant figures on a sub-dollar value. */
function subDollarDecimals(n: number): number {
  // 0.0378 -> 5 decimals; 0.0000031 -> 9. Clamped so it stays a price.
  return Math.min(12, Math.max(2, Math.ceil(-Math.log10(n)) + 3));
}

/**
 * A price at any magnitude, never in scientific notation.
 *
 * Below a dollar, significant digits are what separate 0.0000030 from
 * 0.0000003 — a 10x that decimal places would collapse to $0.00.
 */
export function price(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(2);
  return n.toFixed(subDollarDecimals(n)).replace(/0+$/, "");
}

/** The same, with a dollar sign. */
export function usd(n: number | null): string {
  if (n === null) return "—";
  return `$${price(n)}`;
}

/**
 * Abbreviated, for anything that has to fit a narrow column or an axis.
 *
 * Spans nine orders of magnitude on one screen, so it goes all the way to
 * trillions — stopping at millions printed "$1635553.0M" for BTC.
 */
export function compact(n: number | null): string {
  if (n === null) return "—";
  if (n >= 1_000_000_000_000) return `${(n / 1_000_000_000_000).toFixed(2)}T`;
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  if (n >= 1) return n.toFixed(0);
  // Dust is most of a memecoin tape; rounding it to "0" reads as missing data.
  return n.toFixed(2);
}

/** compact(), with a dollar sign. */
export function compactUsd(n: number | null): string {
  if (n === null) return "—";
  return `$${compact(n)}`;
}

/**
 * A percentage change.
 *
 * Null is "the source did not report this window", which is NOT the same as
 * "it did not move" — printing 0.0% for an unknown is a claim about the
 * market that we cannot support.
 */
export function pct(n: number | null, arrows = true): string {
  if (n === null) return "—";
  const glyph = arrows ? (n >= 0 ? "▲" : "▼") : n >= 0 ? "+" : "-";
  return `${glyph}${Math.abs(n).toFixed(2)}%`;
}

/** Elapsed time, in the coarse units a trader reasons in. */
export function since(unix: number | null, nowMs: number | null): string {
  if (unix === null || nowMs === null) return "";
  const s = Math.max(0, Math.floor(nowMs / 1000) - unix);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 2_592_000) return `${Math.floor(s / 86400)}d`;
  return `${Math.floor(s / 2_592_000)}mo`;
}
