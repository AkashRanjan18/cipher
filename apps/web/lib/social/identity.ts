/**
 * How a person looks on screen: a colour and two letters, from their handle.
 *
 * Moved here from lib/social/mock.ts when that file was deleted (28 Sep 2026).
 * The mock held the last invented activity on screen — the ticker tape's
 * "@vex sold the bottom again" — and these two functions were the only real
 * thing in it.
 */

const HUES = [
  "var(--color-id-violet)",
  "var(--color-id-cyan)",
  "var(--color-id-lime)",
  "var(--color-id-pink)",
  "var(--color-id-sky)",
  "var(--color-id-coral)",
];

/**
 * A stable colour per handle.
 *
 * Hashed rather than stored so a name that has never been seen still gets a
 * consistent colour, and the same person is the same colour everywhere.
 */
export function hueOf(handle: string): string {
  let n = 0;
  for (let i = 0; i < handle.length; i++) n = (n * 31 + handle.charCodeAt(i)) >>> 0;
  return HUES[n % HUES.length];
}

export function initials(handle: string): string {
  return handle.replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase();
}
