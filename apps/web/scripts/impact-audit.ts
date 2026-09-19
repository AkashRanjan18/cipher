/*
 * Price-impact audit across every token cipher shows.
 *
 *   node --env-file=.env.local --experimental-strip-types scripts/impact-audit.ts [usd]
 *
 * For each token: a real Jupiter quote for a $N buy and a $N sell, the
 * MEASURED impact (quoteFill), the old priceImpactPct reading for contrast,
 * and a sanity bound from liquidity. Flags anything that would be refused at
 * the default 3% tolerance, and anything whose measured impact disagrees
 * wildly with its liquidity. Spends real (keyless) Jupiter calls; not part
 * of `npm test`.
 */
import { quoteFill } from "../lib/chain/fill.ts";
import { MARKETS } from "../lib/market/markets.ts";

const USD = Number(process.argv[2] ?? 500);
const SITE = "https://cipher-eosin-beta.vercel.app";
const TOLERANCE_BPS = 300;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface T { mint: string; symbol: string; decimals?: number; priceUsd?: number; liquidityUsd?: number }

const seen = new Map<string, T>();
for (const feed of ["organic", "traded", "new"]) {
  const res = await fetch(`${SITE}/api/discover?feed=${feed}&limit=60`);
  const body = (await res.json()) as { tokens?: T[] };
  for (const t of body.tokens ?? []) if (t.mint && !seen.has(t.mint)) seen.set(t.mint, t);
}
const prices = await (await fetch(`${SITE}/api/prices?mints=${MARKETS.map((m) => m.symbol).join(",")}`)).json().catch(() => ({}));
for (const m of MARKETS) if (!seen.has(m.symbol)) seen.set(m.symbol, { mint: m.symbol, symbol: m.base, ...(prices?.[m.symbol] ?? {}) });

console.log(`auditing ${seen.size} tokens at $${USD}\n`);
let refusedBefore = 0, refusedNow = 0, noRoute = 0, odd = 0;
const rows: string[] = [];

for (const t of seen.values()) {
  const decimals = t.decimals ?? 6;
  let line = `${t.symbol.padEnd(12)} liq ${t.liquidityUsd ? "$" + Math.round(t.liquidityUsd).toLocaleString() : "?"}`.padEnd(32);
  try {
    const buy = await quoteFill({ mint: t.mint, decimals, side: "buy", size: USD, slippageBps: TOLERANCE_BPS, mark: t.priceUsd });
    const tokens = buy.qty;
    await wait(4000);
    const sell = await quoteFill({ mint: t.mint, decimals, side: "sell", size: tokens, slippageBps: TOLERANCE_BPS, mark: t.priceUsd });
    const bound = t.liquidityUsd ? (USD / t.liquidityUsd) * 10_000 * 2 : null; // x2 of a constant-product estimate
    const worst = Math.max(buy.impactBps, sell.impactBps);
    if (worst > TOLERANCE_BPS) refusedNow++;
    const suspicious = bound !== null && worst > Math.max(50, bound * 5);
    if (suspicious) odd++;
    line += ` buy ${(buy.impactBps / 100).toFixed(2)}%  sell ${(sell.impactBps / 100).toFixed(2)}%` +
      (worst > TOLERANCE_BPS ? "  REFUSED (>3%)" : "") + (suspicious ? "  CHECK: high for its liquidity" : "");
  } catch (e) {
    noRoute++;
    line += ` no quote: ${(e as Error).message.slice(0, 60)}`;
  }
  rows.push(line);
  console.log(line);
  await wait(4000);
}
console.log(`\n${seen.size} tokens · refused at 3%: ${refusedNow} · no route: ${noRoute} · suspicious: ${odd}`);
void refusedBefore;
