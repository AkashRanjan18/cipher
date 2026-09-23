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

function load(): Promise<Registry> {
  cached ??= fetch("/tokens.json")
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .catch(() => ({ generatedAt: "", tokens: [] }) satisfies Registry);
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
