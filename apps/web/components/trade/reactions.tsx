"use client";

import { useState } from "react";

/**
 * Emoji reactions with an optimistic local toggle.
 *
 * State is local and throwaway because there is no backend to persist it to.
 * When one exists this becomes a mutation; the markup does not change.
 */
export function Reactions({ initial }: { initial: Record<string, number> }) {
  const [counts, setCounts] = useState(initial);
  const [mine, setMine] = useState<Record<string, boolean>>({});

  function toggle(emoji: string) {
    const on = mine[emoji];
    setCounts((c) => ({ ...c, [emoji]: c[emoji] + (on ? -1 : 1) }));
    setMine((m) => ({ ...m, [emoji]: !on }));
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {Object.entries(counts).map(([emoji, n]) => (
        <button
          key={emoji}
          onClick={() => toggle(emoji)}
          aria-pressed={Boolean(mine[emoji])}
          className={`rounded-full border px-2 py-0.5 font-mono text-[11px] transition-colors ${
            mine[emoji]
              ? "border-accent/50 bg-accent/15 text-accent"
              : "border-hairline bg-ink text-ash hover:border-accent/40 hover:text-champagne"
          }`}
        >
          {emoji} {n}
        </button>
      ))}
    </div>
  );
}
