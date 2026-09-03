/**
 * Bonding-curve tokens — pump.fun and Meteora DBC, before graduation.
 *
 * A launchpad token does not have an AMM pool. It trades against a bonding
 * curve held by the launchpad program: buys walk the price up a fixed
 * formula, and once enough SOL has accumulated the curve closes and the
 * whole thing migrates atomically to a real DEX. pump.fun sends graduates to
 * PumpSwap.
 *
 * This is where memecoin volume actually starts, and it is the section fomo
 * calls "bonding". Fewer than 2% of pump.fun tokens ever graduate, so a
 * bonding token is a categorically riskier trade than anything on the
 * trending list — which is exactly why it gets its own tab rather than being
 * mixed in.
 */

/**
 * DEX ids that mean "still on a curve, has not graduated".
 *
 * Sourced from GeckoTerminal's `dex` relationship. `pumpswap` is deliberately
 * ABSENT: that is where pump.fun tokens land AFTER graduating, so treating it
 * as bonding would put graduated tokens in the pre-graduation list.
 */
export const BONDING_DEXES = new Set(["pump-fun", "meteora-dbc", "pumpfun"]);

export function isBonding(dex: string): boolean {
  return BONDING_DEXES.has(dex.toLowerCase());
}

/**
 * Market cap at which a pump.fun curve completes.
 *
 * cipher: the real invariant is ~85 SOL accumulated in the curve, so the
 * dollar figure drifts with SOL. $69k is the commonly quoted equivalent and
 * is close enough for a progress bar a trader reads as "nearly there" or
 * "just launched". It is NOT accurate enough to trade the graduation itself.
 *
 * Upgrade path: read the bonding curve account directly over RPC
 * (`realSolReserves` vs the program's completion threshold) once there is a
 * Helius key. That is exact, and it is the same call the buy path will need.
 */
const GRADUATION_MCAP_USD = 69_000;

/**
 * How far along the curve this token is, 0-100.
 *
 * Null when there is no market cap to judge by — a bar drawn from a missing
 * number would read as "just launched" for a token we simply know nothing
 * about, and those are very different trades.
 */
export function graduationProgress(fdvUsd: number | null): number | null {
  if (fdvUsd === null || fdvUsd <= 0) return null;
  // Clamped: a token can briefly exceed the threshold before the migration
  // transaction lands, and a 112% progress bar reads as a bug.
  return Math.min(100, (fdvUsd / GRADUATION_MCAP_USD) * 100);
}
