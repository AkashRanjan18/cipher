/**
 * Jurisdiction gating.
 *
 * Two different rules, for two different reasons:
 *
 *   OFAC jurisdictions    blocked everywhere, always. Not a business
 *                         decision — sanctions apply to the whole product.
 *
 *   US persons            allowed on spot. Blocked only from leveraged
 *                         derivatives and event markets.
 *
 * Non-custodial spot swaps are not a regulated activity for a front end:
 * the user holds their own keys, we never take custody, and money
 * transmitter licensing turns on control of funds. Jupiter, Photon, BullX,
 * Axiom and fomo all serve US users on spot. fomo's "not available to US
 * persons" is specific to perps, which are leveraged derivatives requiring a
 * CFTC-registered venue.
 *
 * This is a compliance control, not a security control. IP geolocation is
 * defeatable and everyone knows it. The standard it meets is "reasonable
 * measures": block on IP, ask the user to attest, log it, don't market in.
 */

export type CountryCode = string;

/**
 * Sanctioned. Blocked on every gated path, no exceptions, no surface where
 * this is negotiable.
 */
export const OFAC_COUNTRIES: ReadonlySet<CountryCode> = new Set([
  "KP", // North Korea
  "IR", // Iran
  "SY", // Syria
  "CU", // Cuba
]);

/** Occupied Ukrainian regions, which carry their own sanctions programmes. */
export const OFAC_REGIONS: ReadonlySet<string> = new Set([
  "UA-43", // Crimea
  "UA-14", // Donetsk
  "UA-09", // Luhansk
]);

/**
 * Surfaces US persons may not reach.
 *
 * Perps are leveraged derivatives and require a CFTC-registered venue we do
 * not have. Event markets are CFTC event contracts — the category Polymarket
 * was fined $1.4M over and excluded from the US for three years.
 *
 * Spot is deliberately absent.
 */
const US_RESTRICTED_PREFIXES = [
  "/perps",
  "/api/perps",
  "/markets", // event tokens, when they land
  "/api/markets",
] as const;

/**
 * Paths open to everyone, everywhere.
 *
 * The scanner reads public chain history and does arithmetic on it. That is
 * not a regulated activity anywhere, and it is the top of the funnel.
 */
const OPEN_PREFIXES = [
  "/",
  "/w/",
  "/api/scan",
  "/restricted",
  "/legal",
  "/_next",
  "/favicon",
  "/opengraph-image",
] as const;

export function isOpenPath(pathname: string): boolean {
  if (pathname === "/") return true;
  return OPEN_PREFIXES.some((p) => p !== "/" && pathname.startsWith(p));
}

/** True when this path is one US persons may not reach. */
export function isUsRestrictedPath(pathname: string): boolean {
  return US_RESTRICTED_PREFIXES.some((p) => pathname.startsWith(p));
}

export interface GeoSignal {
  country?: string | null;
  region?: string | null;
}

export type GateDecision =
  | { allow: true }
  | {
      allow: false;
      reason: "sanctioned-country" | "sanctioned-region" | "us-derivatives" | "unknown-origin";
      code?: string;
    };

/**
 * Decide whether a request may reach a gated path.
 *
 * `failClosed` should be true in production and false locally, where no CDN
 * sets geo headers and every request would otherwise look like an unknown
 * origin. Failing open in production would make the control decorative.
 */
export function gate(
  signal: GeoSignal,
  pathname: string,
  failClosed: boolean,
): GateDecision {
  const country = signal.country?.trim().toUpperCase();
  const region = signal.region?.trim().toUpperCase();

  if (!country) {
    // Unknown origin can only be refused where the restriction is real.
    // Failing closed on spot would block every request behind a CDN that
    // does not set the header — a much larger group than US persons.
    if (!failClosed) return { allow: true };
    return isUsRestrictedPath(pathname)
      ? { allow: false, reason: "unknown-origin" }
      : { allow: true };
  }

  if (OFAC_COUNTRIES.has(country)) {
    return { allow: false, reason: "sanctioned-country", code: country };
  }

  if (country === "UA" && region && OFAC_REGIONS.has(`UA-${region}`)) {
    return { allow: false, reason: "sanctioned-region", code: `UA-${region}` };
  }

  if (country === "US" && isUsRestrictedPath(pathname)) {
    return { allow: false, reason: "us-derivatives", code: "US" };
  }

  return { allow: true };
}

/**
 * Pull a country out of whatever CDN we are behind. Vercel and Cloudflare use
 * different headers; check both so the control survives a hosting change.
 */
export function readGeo(headers: { get(name: string): string | null }): GeoSignal {
  return {
    country:
      headers.get("x-vercel-ip-country") ??
      headers.get("cf-ipcountry") ??
      headers.get("x-country-code"),
    region:
      headers.get("x-vercel-ip-country-region") ?? headers.get("cf-region-code"),
  };
}
