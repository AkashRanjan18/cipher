/**
 * Write public/tokens.json — the registry the app ships with.
 *
 *   node --env-file=.env.local --experimental-strip-types scripts/registry/build.ts
 *
 * A SEED, NOT THE SOURCE. /api/tokens rebuilds the same object from Jupiter on
 * an hourly cache window and is what the app reads first; this file is what it
 * falls back to when that route cannot be reached. Names never go stale, so a
 * seed is a perfectly good spelling dictionary months later — it is only the
 * prices, which `readScale` weighs a spoken number against, that drift.
 *
 * The building lives in lib/market/build-registry.ts, shared with the route.
 * Two producers of the same file would drift, and the one that drifted would
 * be the one nobody ran.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildRegistry } from "../../lib/market/build-registry.ts";

const flag = process.argv.indexOf("--limit");
const limit = flag === -1 ? 100 : Number(process.argv[flag + 1]) || 100;

const registry = await buildRegistry(limit);

const out = resolve(import.meta.dirname, "../../public/tokens.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(registry, null, 0) + "\n");

const withCap = registry.tokens.filter((t) => t.cap).length;
console.log(
  `${registry.tokens.length} tokens (${withCap} with a market cap) → ${out}\n` +
    `${(JSON.stringify(registry).length / 1024).toFixed(0)} KB`,
);
