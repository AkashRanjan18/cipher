/**
 * Market concepts shared between the app and anything that runs beside it.
 *
 * `Interval` lived in apps/web/lib/market/types.ts, which was right until the
 * Intent union needed it — packages/shared cannot import upward from an app,
 * and duplicating a closed union in two places is how the two versions
 * silently diverge.
 */

/**
 * Chart intervals the UI offers.
 *
 * A closed union, not a string, because these map to a specific
 * (timeframe, aggregate) pair upstream — GeckoTerminal has no "4h" endpoint,
 * it has "hour" aggregated by 4. Letting a component pass an arbitrary string
 * would push that translation into the UI.
 */
export type Interval = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
