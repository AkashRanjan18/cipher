import { hueOf, initials } from "@/lib/social/mock";

/**
 * A person, as a coloured disc with their initials.
 *
 * Used in the rail, on chart markers, in the tape and in the flock stack, so
 * it lives on its own — the colour must be identical in all four or the same
 * person reads as different people.
 */
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
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full font-sans font-bold text-ink"
      style={{
        width: size,
        height: size,
        fontSize: Math.max(7, size * 0.38),
        background: you ? "var(--color-accent)" : hueOf(who),
        boxShadow: ring ? "0 0 0 1.5px var(--color-panel)" : undefined,
      }}
    >
      {you ? "ME" : initials(who)}
    </span>
  );
}
