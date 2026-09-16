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

/**
 * What a paper account opens with.
 *
 * ZERO as of 17 Sep 2026, on the user's instruction. The consequence is real
 * and deliberate: with no balance every buy refuses with "that needs $X and
 * you have $0.00" until money is put in, so the terminal opens as an empty
 * account rather than a funded demo.
 *
 * IT LIVES HERE BECAUSE IT WAS DEFINED TWICE. `lib/db/accounts.ts` had its own
 * copy carrying the comment "mirrored from the client store", which is the
 * shape of a bug rather than a mirror — change one and the server opens an
 * account at a balance the browser does not believe in, and the two halves
 * disagree about how much money someone has. Shared is the one place both a
 * client component and a server route can import from without one of them
 * dragging in the other's dependencies.
 */
export const OPENING_DEPOSIT = 0;
