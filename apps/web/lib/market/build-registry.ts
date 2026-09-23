import { discover } from "../chain/discover.ts";
import { displayCap, type TokenInfo } from "../chain/tokens.ts";
import { MARKETS } from "./markets.ts";
import type { Registry, RegistryToken } from "./registry.ts";

/**
 * Build the token registry from Jupiter.
 *
 * IN lib/ RATHER THAN IN THE ROUTE, because a route cannot be imported by the
 * test runner — it reaches its dependencies through the `@/` alias and pulls
 * in next/server — so anything living in one is code with no test behind it.
 * The route is a cache header and a call to this.
 *
 * Shared with scripts/registry/build.ts, which writes the same object to
 * public/tokens.json as the seed the app ships with. Two producers of the same
 * file would drift, and the one that drifted would be the one nobody ran.
 */

/**
 * Jupiter's three feeds, in the order a trader would look at them.
 *
 * All three because they answer different questions and overlap only partly:
 * `traded` is where the volume is, `organic` filters out manufactured
 * activity, `new` is what launched in the last hours. A token is kept once, by
 * mint, and the first feed to mention it wins.
 */
const FEEDS = ["traded", "organic", "new"] as const;

/**
 * The names a major is known by, keyed by mint.
 *
 * Jupiter calls the SOL mint "Wrapped SOL", so the word "Solana" appears
 * nowhere in its metadata and matched nothing at all. MARKETS already holds
 * the human name the chart header shows.
 */
const ALIASES = new Map<string, string[]>(MARKETS.map((m) => [m.symbol, [m.base, m.name]]));

function toRegistry(t: TokenInfo): RegistryToken {
  const extra = (ALIASES.get(t.mint) ?? []).filter(
    (a) => a.toLowerCase() !== t.symbol.toLowerCase() && a.toLowerCase() !== t.name.toLowerCase(),
  );
  return {
    ...(extra.length ? { aliases: extra } : {}),
    mint: t.mint,
    symbol: t.symbol,
    name: t.name,
    price: t.priceUsd,
    /* displayCap picks fdv over mcap — the figure a trader means, and the one
       already on the chart header. Two places reaching for `mcap` separately
       is how the number on screen and the number in an order drift apart. */
    cap: displayCap(t),
    decimals: t.decimals,
    verified: t.verified,
  };
}

export async function buildRegistry(limit = 100): Promise<Registry> {
  const seen = new Map<string, RegistryToken>();

  for (const feed of FEEDS) {
    try {
      for (const t of await discover(feed, { limit })) {
        if (!t.mint || !(t.priceUsd > 0)) continue;
        if (!seen.has(t.mint)) seen.set(t.mint, toRegistry(t));
      }
    } catch {
      /* A feed that fails is not fatal: the others still describe the market,
         and a registry missing one slice beats no registry. The caller decides
         whether a short file is worth reporting. */
    }
  }

  /* The majors are pinned in even if no feed listed them — "buy $500 of sol"
     must never fail because SOL was not trending. */
  for (const m of MARKETS) {
    if (seen.has(m.symbol)) continue;
    seen.set(m.symbol, {
      mint: m.symbol,
      symbol: m.base,
      name: m.name,
      aliases: [m.base, m.name],
      price: 0,
      cap: null,
      decimals: 9,
      verified: true,
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    /* Verified first, then by name, so the file diffs readably between runs. */
    tokens: [...seen.values()].sort(
      (a, b) => Number(b.verified) - Number(a.verified) || a.symbol.localeCompare(b.symbol),
    ),
  };
}
