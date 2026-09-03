"use client";

import { useEffect, useState } from "react";

/**
 * The current time, but only once the component is running in the browser.
 *
 * Anything rendered from `Date.now()` is a hydration bug waiting to happen:
 * the server stamps "42s", the client hydrates a second later and computes
 * "43s", React sees the mismatch and throws away the whole subtree. On the
 * tape that is several hundred rows discarded and rebuilt on every load.
 *
 * Returning null until mount is what fixes it — the server and the client's
 * first render agree on "nothing", and the real value arrives immediately
 * after. Callers render a placeholder for null.
 *
 * The interval is a second bonus: ages now tick continuously instead of
 * freezing between polls, which is what makes the panel look alive.
 */
export function useNow(intervalMs = 1000): number | null {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}
