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
  /* minimumFractionDigits too, or an account balance renders "$9,497.5" —
     toLocaleString trims the trailing zero, and money with one decimal place
     reads as a typo on a screen where every other figure has two. */
  if (n >= 1000)
    return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

/**
 * A QUANTITY OF TOKENS, which is not a quantity of dollars.
 *
 * `compact` was used for this and rounded 2.5064 SOL to "3 SOL" — it floors at
 * `toFixed(0)` above 1, because it was written for market caps and chart axes
 * where a decimal place on a billion is noise. On a holding it is a lie about
 * how much you own, printed next to the price you paid for it.
 *
 * The split is at ten thousand. Below that the exact number fits and matters:
 * five SOL is 5.0128 and the four decimals are real money. Above it nobody
 * reads nineteen million to the unit, and "19.19M" is both shorter and just
 * as true.
 *
 * `maximumFractionDigits` rather than toFixed, so trailing zeros never show —
 * a round 5 prints "5", not "5.0000".
 */
export function units(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n >= 10_000) return compact(n);
  /* Six decimals under a dollar's worth for the same reason `price` uses
     significant digits down there: 0.000003 and 0.000030 are a 10x apart. */
  return n.toLocaleString("en-US", { maximumFractionDigits: n >= 1 ? 4 : 6 });
}

/**
 * compact(), without the padding zeros — for prose rather than a column.
 *
 * `compact` fixes the decimals so a column of figures lines up, which is right
 * on an axis and wrong in a sentence: "I'll buy $3.40M of BONK" reads like a
 * spreadsheet talking. A readback is the user's own words handed back, so the
 * number is written the way they would have said it.
 *
 * Below a thousand nothing is abbreviated, because "$500" is already how
 * anyone says $500 and "$0.5K" is how nobody does.
 */
export function compactWords(n: number | null): string {
  if (n === null) return "—";
  /* Whole dollars stay whole: "$500", never "$500.00". `price()` is for
     figures that need their decimals, and under a thousand most do not. */
  if (n < 1_000) return Number.isInteger(n) ? String(n) : price(n);
  return compact(n).replace(/\.?0+(?=[KMBT]$)/, "");
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

/**
 * Rewrite the big numbers in a sentence as K and M.
 *
 * For the PROMPT BAR, not for the compiler. "buy at 3400000" is a number
 * nobody says and nobody can check at a glance; "buy at 3.4M" is how it was
 * spoken in the first place. The user's rule, 24 Sep 2026.
 *
 * Under a thousand nothing is touched, so prices like 0.0038 and sizes like
 * $500 come through exactly as they are — and a memecoin price must never be
 * rounded into a K.
 *
 * SAFE TO RE-PARSE, and that is a constraint rather than a nicety: whatever
 * this writes into the bar is what gets compiled when the user presses Enter.
 * normaliseSpeech expands "3.4M" back to 3400000 before the grammar sees it,
 * so the round trip is lossless. It was not until 24 Sep 2026 — millions were
 * left alone because "m" also means minutes — and compacting without fixing
 * that would have silently dropped every number it prettified.
 */
export function compactNumbers(text: string): string {
  return text.replace(/(\$?)(\d[\d,]*(?:\.\d+)?)/g, (whole, dollar: string, digits: string) => {
    const value = Number(digits.replace(/,/g, ""));
    if (!Number.isFinite(value) || value < 1_000) return whole;
    return dollar + compactWords(value);
  });
}
