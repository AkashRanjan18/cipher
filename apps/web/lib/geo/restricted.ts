/**
 * Jurisdiction gating.
 *
 * This is a compliance control, not a security control. IP geolocation is
 * defeatable with a VPN and everyone knows it. The standard it has to meet is
 * "reasonable measures to prevent access", which means: block on IP, ask the
 * user to attest, log the result, and don't market into the blocked market.
 *
 * The thing that cannot be fixed retroactively is having served restricted
 * users for a year. Polymarket paid $1.4M and three years of US exclusion.
 */

/** ISO 3166-1 alpha-2. */
export type CountryCode = string;

/**
 * The US is blocked because trading is the regulated activity and we hold no
 * licence. The rest are OFAC-sanctioned and are table stakes for any crypto
 * product.
 */
export const RESTRICTED_COUNTRIES: ReadonlySet<CountryCode> = new Set([
  "US", // no broker-dealer / MSB registration; the whole reason for this file
  "KP", // North Korea
  "IR", // Iran
  "SY", // Syria
  "CU", // Cuba
]);

/** Occupied Ukrainian regions, which carry their own sanctions programmes. */
export const RESTRICTED_REGIONS: ReadonlySet<string> = new Set([
  "UA-43", // Crimea
  "UA-14", // Donetsk
  "UA-09", // Luhansk
]);

/**
 * Paths that stay open everywhere.
 *
 * The scanner is deliberately public: it reads public chain history and gives
 * back an analysis. That is not a regulated activity, and it is the top of the
 * funnel — a US visitor who sees their number and shares the card is still
 * worth having. We gate the trading, not the arithmetic.
 */
const OPEN_PREFIXES = [
  "/",              // landing
  "/w/",            // scanner results + share cards
  "/api/scan",      // scanner API
  "/restricted",    // the page we send blocked users to
  "/legal",
  "/_next",
  "/favicon",
  "/opengraph-image",
] as const;

export function isOpenPath(pathname: string): boolean {
  if (pathname === "/") return true;
  return OPEN_PREFIXES.some((p) => p !== "/" && pathname.startsWith(p));
}

export interface GeoSignal {
  country?: string | null;
  region?: string | null;
}

export type GateDecision =
  | { allow: true }
  | { allow: false; reason: "restricted-country" | "restricted-region" | "unknown-origin"; code?: string };

/**
 * Decide whether a request may reach a gated path.
 *
 * `failClosed` should be true in production and false locally, where no CDN
 * sets geo headers and every request would otherwise look like an unknown
 * origin. Failing open in production would make the whole control decorative.
 */
export function gate(signal: GeoSignal, failClosed: boolean): GateDecision {
  const country = signal.country?.trim().toUpperCase();
  const region = signal.region?.trim().toUpperCase();

  if (!country) {
    return failClosed
      ? { allow: false, reason: "unknown-origin" }
      : { allow: true };
  }

  if (RESTRICTED_COUNTRIES.has(country)) {
    return { allow: false, reason: "restricted-country", code: country };
  }

  if (country === "UA" && region && RESTRICTED_REGIONS.has(`UA-${region}`)) {
    return { allow: false, reason: "restricted-region", code: `UA-${region}` };
  }

  return { allow: true };
}

/**
 * Pull a country out of whatever CDN we happen to be behind.
 * Vercel and Cloudflare use different headers; check both so the control keeps
 * working if hosting changes.
 */
export function readGeo(headers: {
  get(name: string): string | null;
}): GeoSignal {
  return {
    country:
      headers.get("x-vercel-ip-country") ??
      headers.get("cf-ipcountry") ??
      headers.get("x-country-code"),
    region:
      headers.get("x-vercel-ip-country-region") ??
      headers.get("cf-region-code"),
  };
}
