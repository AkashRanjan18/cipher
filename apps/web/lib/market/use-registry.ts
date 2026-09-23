"use client";

import { useEffect, useState } from "react";
import type { Registry, RegistryToken } from "./registry.ts";

/**
 * The token registry, fetched once and shared by everything that needs it.
 *
 * MODULE-LEVEL, NOT PER-COMPONENT. The file is ~30 KB and never changes
 * between renders, so a `useState` inside each consumer would fetch it again
 * for every mount — including every remount of the prompt bar. The promise is
 * cached here, so the first caller pays for it and everybody else awaits the
 * same one.
 *
 * FAILURE IS SILENT AND TOTAL. No registry means no correction and no market
 * cap reading; it does NOT mean a broken prompt bar. Everything downstream
 * treats an empty list as "nothing to correct against", the grammar still
 * parses, and the compiler still refuses what it cannot resolve. A spelling
 * aid that takes the order bar down with it would be worse than no aid.
 */
let cached: Promise<Registry> | null = null;

const empty: Registry = { generatedAt: "", tokens: [] };

async function fetchJson(url: string): Promise<Registry | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const body = (await r.json()) as Registry;
    return Array.isArray(body?.tokens) && body.tokens.length > 0 ? body : null;
  } catch {
    return null;
  }
}

/**
 * The live registry first, the shipped seed second.
 *
 * /api/tokens rebuilds from Jupiter on an hourly cache window, so its prices
 * are current — which is what `readScale` needs to tell a price from a market
 * cap. public/tokens.json is whatever the market looked like when someone
 * last ran the script; its NAMES are just as good, and names are what the
 * spelling correction runs on. So a dead route degrades the scale reading and
 * leaves the correction intact, which is the right thing to lose first.
 */
function load(): Promise<Registry> {
  cached ??= (async () =>
    (await fetchJson("/api/tokens")) ?? (await fetchJson("/tokens.json")) ?? empty)();
  return cached;
}

export function useRegistry(): RegistryToken[] {
  const [tokens, setTokens] = useState<RegistryToken[]>([]);

  useEffect(() => {
    let alive = true;
    load().then((r) => {
      if (alive) setTokens(r.tokens);
    });
    return () => {
      alive = false;
    };
  }, []);

  return tokens;
}
