import { hueOf, initials } from "@/lib/social/mock";

/**
 * A person, drawn rather than lettered.
 *
 * This was a flat disc with two initials, and it was the single biggest
 * reason the terminal read as dead next to fomo: their rail is full of
 * photographs, ours was full of monograms. Faces are what make a social
 * product look inhabited.
 *
 * We have no photographs and inventing them would be worse than none, so
 * each handle gets a generated mark instead — two hues, a gradient and one
 * of six geometries, all derived from the handle. Deterministic, offline,
 * and distinct enough that you recognise someone by their disc the way you
 * would by their picture.
 *
 * Used in the rail, the tape, the flock stack and chart markers, so it lives
 * on its own: the same person must be identical in all four or they read as
 * four people.
 */

/** Same hash as hueOf, so a handle's mark and its accent colour agree. */
function hash(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) n = (n * 31 + s.charCodeAt(i)) >>> 0;
  return n;
}

/**
 * The second hue, picked far enough around the identity list that the pair
 * always has visible contrast. Adjacent hues produced gradients that looked
 * like a smudge of one colour.
 */
const SECOND: string[] = [
  "var(--color-id-violet)",
  "var(--color-id-cyan)",
  "var(--color-id-lime)",
  "var(--color-id-pink)",
  "var(--color-id-sky)",
  "var(--color-id-coral)",
];

export function Avatar({
  who,
  size = 26,
  ring,
}: {
  who: string;
  size?: number;
  /** Draws a hairline in the panel colour, for overlapping stacks. */
  ring?: boolean;
}) {
  const you = who === "you";
  const n = hash(who);

  // Your own mark stays the accent colour and keeps its letters: on a screen
  // full of other people, "which one is me" must be answerable instantly.
  if (you) {
    return (
      <span
        className="grid shrink-0 place-items-center rounded-full bg-accent font-sans font-bold text-ink"
        style={{
          width: size,
          height: size,
          fontSize: Math.max(7, size * 0.38),
          boxShadow: ring ? "0 0 0 1.5px var(--color-panel)" : undefined,
        }}
      >
        ME
      </span>
    );
  }

  const a = hueOf(who);
  // +3 lands opposite in a six-colour list, so the pair never sits adjacent.
  const b = SECOND[(n + 3) % SECOND.length];
  const shape = n % 6;
  const id = `av${(n % 100000).toString(36)}`;

  return (
    <svg
      viewBox="0 0 40 40"
      width={size}
      height={size}
      aria-hidden
      className="shrink-0 rounded-full"
      style={{ boxShadow: ring ? "0 0 0 1.5px var(--color-panel)" : undefined }}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={a} />
          <stop offset="100%" stopColor={b} />
        </linearGradient>
        {/* Everything is drawn full-bleed and clipped, so no geometry needs
            to know the disc's radius. */}
        <clipPath id={`${id}c`}>
          <circle cx="20" cy="20" r="20" />
        </clipPath>
      </defs>

      <g clipPath={`url(#${id}c)`}>
        <rect width="40" height="40" fill={`url(#${id})`} />

        {/* Six geometries. Drawn in the ink colour at low alpha rather than in
            a third hue — a third colour per avatar turned the rail into
            confetti and stopped reading as people. */}
        {shape === 0 && <circle cx="28" cy="12" r="13" fill="var(--color-ink)" opacity="0.28" />}
        {shape === 1 && <rect x="-4" y="22" width="48" height="22" fill="var(--color-ink)" opacity="0.25" />}
        {shape === 2 && <path d="M0 40 L40 0 L40 40 Z" fill="var(--color-ink)" opacity="0.24" />}
        {shape === 3 && (
          <>
            <circle cx="20" cy="20" r="15" fill="none" stroke="var(--color-ink)" strokeWidth="5" opacity="0.24" />
          </>
        )}
        {shape === 4 && (
          <>
            <circle cx="8" cy="30" r="12" fill="var(--color-ink)" opacity="0.22" />
            <circle cx="32" cy="10" r="8" fill="var(--color-ink)" opacity="0.22" />
          </>
        )}
        {shape === 5 && <path d="M0 26 Q20 6 40 26 L40 40 L0 40 Z" fill="var(--color-ink)" opacity="0.26" />}
      </g>

      {/* A title makes the disc readable to a screen reader and hoverable for
          anyone who cannot tell two gradients apart. */}
      <title>{initials(who)}</title>
    </svg>
  );
}
