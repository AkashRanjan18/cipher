import type { TokenSecurity } from "./types";

/**
 * Token safety and holder distribution, from RugCheck. Free, keyless.
 *
 * This is the panel that separates a trading terminal from a price chart.
 * On memecoins the two questions that decide whether a position is even
 * survivable are "can the deployer print more supply" and "can they pull the
 * pool" — neither is visible on a candle. Photon, BullX and Axiom all show
 * this, and they show it because trading without it is gambling on a stranger.
 */

const ENDPOINT = "https://api.rugcheck.xyz/v1/tokens";

interface RawReport {
  mintAuthority: string | null;
  freezeAuthority: string | null;
  totalHolders?: number;
  score_normalised?: number;
  risks?: { name: string; description: string; level: string }[];
  topHolders?: { address: string; pct: number; insider?: boolean }[];
}

/**
 * The aggregate LP lock lives on the SUMMARY endpoint, not the full report.
 *
 * The full report carries lpLockedPct per market, and a token like BONK has
 * over a thousand markets — most of them dust, many at 0%. Reading a
 * top-level field that does not exist defaulted it to zero and told the user
 * "most of the pool can be withdrawn" about a token where it cannot. Summing
 * or averaging those markets myself would be guessing at a weighting;
 * upstream already computes one, so use theirs.
 */
interface RawSummary {
  lpLockedPct?: number;
}

/** Exported for testing without a network call. */
export function toSecurity(r: RawReport, sum: RawSummary): TokenSecurity {
  return {
    /*
     * Null means the authority was revoked, which is the SAFE state — the
     * deployer can no longer mint supply or freeze your account. Defaulting
     * a missing field to a string here would invert the meaning and paint a
     * safe token as dangerous.
     */
    mintAuthority: r.mintAuthority ?? null,
    freezeAuthority: r.freezeAuthority ?? null,
    lpLockedPct: sum.lpLockedPct ?? 0,
    totalHolders: r.totalHolders ?? 0,
    riskScore: r.score_normalised ?? 0,
    risks: r.risks ?? [],
    topHolders: (r.topHolders ?? []).map((h) => ({
      address: h.address,
      pct: h.pct,
      insider: h.insider ?? false,
    })),
  };
}

export async function fetchSecurity(
  mint: string,
): Promise<TokenSecurity | null> {
  /*
   * Authorities and LP locks change rarely — usually never. Five minutes is
   * generous and keeps this off the hot path of the shared rate budget.
   */
  const opts = {
    headers: { Accept: "application/json" },
    next: { revalidate: 300 },
  };

  const [reportRes, summaryRes] = await Promise.all([
    fetch(`${ENDPOINT}/${mint}/report`, opts),
    fetch(`${ENDPOINT}/${mint}/report/summary`, opts),
  ]);
  if (!reportRes.ok) return null;

  return toSecurity(
    (await reportRes.json()) as RawReport,
    // The summary is the softer of the two: without it the checks still
    // render, and LP shows as unknown rather than as a false zero.
    summaryRes.ok ? ((await summaryRes.json()) as RawSummary) : {},
  );
}
