/**
 * Build public/tokens.json — the registry the prompt bar corrects against.
 *
 *   node --env-file=.env.local --experimental-strip-types scripts/registry/build.ts
 *
 * WHY A FILE AND NOT AN ENDPOINT. The correction has to land while the user is
 * still talking, and a fetch per keystroke cannot do that — not at dictation
 * speed, not on a phone, and not at all when Jupiter is slow. A static file is
 * served from the edge, cached by the browser, and searched in memory.
 *
 * WHY IT IS GENERATED AND NOT WRITTEN BY HAND. Every token on Solana is new
 * once. A hand-maintained list is wrong the day after it is written, and the
 * tokens it is missing are exactly the launches people most want to trade.
 * Re-run this on a schedule; nothing here has to be edited to add a token.
 *
 * cipher: one flat file of the top N by liquidity. That is the right shape up
 * to a few thousand tokens and the wrong shape at a hundred thousand — at that
 * point this becomes a prefix-indexed bundle fetched per first letter, or the
 * match moves server-side behind a debounce. The reader in lib/market/
 * registry.ts does not change either way.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { discover } from "../../lib/chain/discover.ts";
import { displayCap, type TokenInfo } from "../../lib/chain/tokens.ts";
import { MARKETS } from "../../lib/market/markets.ts";
import type { Registry, RegistryToken } from "../../lib/market/registry.ts";

const flag = process.argv.indexOf("--limit");
const LIMIT = flag === -1 ? 200 : Number(process.argv[flag + 1]) || 200;

/**
 * Jupiter's three feeds, in the order a trader would look at them.
 *
 * All three rather than one because they answer different questions and
 * overlap only partly: `traded` is where the volume is, `organic` filters out
 * manufactured activity, `new` is what launched in the last hours. A token is
 * kept once, by mint, and the first feed to mention it wins.
 */
const FEEDS = ["traded", "organic", "new"] as const;

/**
 * The names a major is known by, keyed by mint.
 *
 * Jupiter calls the SOL mint "Wrapped SOL", so the word "Solana" appears
 * nowhere in its metadata and matched nothing. MARKETS already holds the
 * human name the chart header shows; this carries it into the registry so the
 * two surfaces answer to the same words.
 */
const ALIASES = new Map<string, string[]>(
  MARKETS.map((m) => [m.symbol, [m.base, m.name]]),
);

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

const seen = new Map<string, RegistryToken>();

for (const feed of FEEDS) {
  try {
    const rows = await discover(feed, { limit: LIMIT });
    for (const t of rows) {
      if (!t.mint || !(t.priceUsd > 0)) continue;
      /* First feed wins. `trending` runs first, so the entry that survives is
         the one with the liveliest data behind it. */
      if (!seen.has(t.mint)) seen.set(t.mint, toRegistry(t));
    }
    console.log(`  ${feed.padEnd(11)} ${rows.length}`);
  } catch (e) {
    /* A feed that fails is not fatal — the others still describe the market,
       and a registry missing one slice beats no registry at all. It IS worth
       saying out loud, because a silently short file looks identical to a
       quiet market. */
    console.warn(`  ${feed.padEnd(11)} FAILED — ${(e as Error).message}`);
  }
}

/*
 * The majors are pinned in, verified, even if no feed happened to list them.
 *
 * "buy $500 of sol" must never fail because SOL was not trending. MARKETS is
 * the hardcoded list the chart and the ticket already speak, so pinning it
 * here keeps the three surfaces naming the same set of tokens.
 */
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

const registry: Registry = {
  generatedAt: new Date().toISOString(),
  /* Verified first, then by name, so the file diffs readably between runs and
     a reviewer can see what actually changed rather than a reshuffle. */
  tokens: [...seen.values()].sort(
    (a, b) => Number(b.verified) - Number(a.verified) || a.symbol.localeCompare(b.symbol),
  ),
};

const out = resolve(import.meta.dirname, "../../public/tokens.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(registry, null, 0) + "\n");

const withCap = registry.tokens.filter((t) => t.cap).length;
console.log(
  `\n${registry.tokens.length} tokens (${withCap} with a market cap) → ${out}\n` +
    `${(JSON.stringify(registry).length / 1024).toFixed(0)} KB`,
);
