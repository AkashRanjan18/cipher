import { fromJupiter, type Lifecycle, type TokenInfo } from "./tokens.ts";

/**
 * The whole coin universe, at every stage of its life.
 *
 * This is what "all the coins, like fomo" actually requires, and it turned out
 * to be one API rather than four. Jupiter's Token API v2 returns `launchpad`
 * and `graduatedAt` on every token, and the three states people mean —
 * bonding, graduated, legacy — are exactly the combinations of those two.
 *
 * IT ALSO EXECUTES THEM. A token still on a pump.fun curve, with no AMM pool
 * in existence, quotes through the same /swap/v1/quote as SOL and comes back
 * `routed via Pump.fun` with real price impact. There is no separate
 * bonding-curve integration to write, which is the single most surprising
 * thing found while building this. Coverage is not universal — smaller
 * launchpads return no route — and the honest place to discover that is the
 * quote, not a list of launchpads maintained by hand.
 *
 * WHAT THIS IS NOT: a chart. Jupiter returns a price, never a series. Candles
 * for a token nobody lists come from GeckoTerminal, which is a separate file
 * and a separate problem.
 */

const BASE = "https://lite-api.jup.ag/tokens/v2";
const PRO = "https://api.jup.ag/tokens/v2";

function endpoint(): { url: string; headers: Record<string, string> } {
  const key = process.env.JUPITER_API_KEY;
  return key
    ? { url: PRO, headers: { Accept: "application/json", "x-api-key": key } }
    : { url: BASE, headers: { Accept: "application/json" } };
}

/**
 * THE FEEDS, and what each is actually for.
 *
 *   new        /recent — tokens minted in the last minutes. Almost all of
 *              these are bonding, almost all are worthless, and this is the
 *              feed a launch sniper lives on.
 *   traded     24h volume leaders. What is actually moving money.
 *   organic    Jupiter's organic score — real activity separated from wash
 *              trading. The closest thing to an honest trending list, and the
 *              reason it exists is that volume alone is trivially faked.
 */
/*
 * SEVERAL WINDOWS PER FEED, because one of them caps at a hundred.
 *
 * Jupiter returns at most 100 tokens however many are asked for — 200 and 300
 * both come back with 100 — and it does not paginate: `offset`, `page` and
 * `skip` all return the identical first row. So a longer list cannot be had
 * from one call, and the ceiling was the list's real length rather than any
 * number chosen here.
 *
 * The same feed over four windows is four different questions, and the answers
 * only partly overlap: 24h, 6h, 1h and 5m together yield 162 unique tokens on
 * traded and 167 on organic. Every one of them is genuinely top-traded or
 * genuinely organic — just over a different period — so the list gets longer
 * without any of it becoming untrue.
 *
 * ORDER IS 24h FIRST, AND THAT IS THE POINT. Deduplication keeps the first
 * sighting, so the established daily ranking stays at the top exactly as it
 * was and the shorter windows only ever extend the tail. Scrolling goes
 * further; the first screen does not move.
 */
export const FEEDS = {
  new: ["recent"],
  traded: ["toptraded/24h", "toptraded/6h", "toptraded/1h", "toptraded/5m"],
  organic: [
    "toporganicscore/24h",
    "toporganicscore/6h",
    "toporganicscore/1h",
    "toporganicscore/5m",
  ],
} as const;

export type Feed = keyof typeof FEEDS;

export function isFeed(v: string): v is Feed {
  return v in FEEDS;
}

export interface DiscoverOptions {
  /** Keep only one stage of life. Undefined means all three. */
  lifecycle?: Lifecycle;
  limit?: number;
  /**
   * Seconds to reuse the upstream response for.
   *
   * THE SAME ARITHMETIC AS THE PRICE CACHE, and it is what makes this
   * affordable. Jupiter allows 60 requests a minute for the entire deployment,
   * so a per-user fetch dies at about the sixtieth user. But a list of new
   * launches is IDENTICAL for everyone looking at it — it is a property of the
   * chain, not of the viewer — so an N-second window costs at most 60/N
   * requests a minute however many people are watching.
   *
   * Ten seconds is 6/min. A launch feed wants to be fast; nothing else here
   * changes meaningfully inside ten seconds.
   */
  revalidate?: number;
  signal?: AbortSignal;
}

export class DiscoverError extends Error {}

export async function discover(feed: Feed, options: DiscoverOptions = {}): Promise<TokenInfo[]> {
  const { lifecycle, limit = 50, revalidate = 10, signal } = options;
  const { url, headers } = endpoint();

  /*
   * Asked for wider than requested when a filter is on.
   *
   * The lifecycle filter is applied HERE rather than upstream, because Jupiter
   * has no parameter for it — so filtering to "graduated" over a 50-token page
   * can return three. Over-fetching keeps a filtered feed from looking empty
   * when it is merely selective. The cap is Jupiter's own.
   */
  const ask = Math.min(lifecycle ? limit * 4 : limit, 100);

  /*
   * ONE WINDOW UNLESS MORE IS ASKED FOR.
   *
   * A single call returns up to 100 rows, so anything at or under that is
   * already served by the 24h window alone — and since deduplication keeps the
   * first sighting, the extra windows would contribute nothing but three more
   * requests against an allowance measured per deployment. They exist for the
   * case where the caller genuinely wants a longer list than Jupiter will
   * return in one response.
   */
  const paths = ask > 100 ? FEEDS[feed] : FEEDS[feed].slice(0, 1);
  const query = feed === "new" ? "" : `?limit=${ask}`;

  /*
   * IN PARALLEL, AND ONE FAILURE IS NOT ALL OF THEM.
   *
   * Four sequential round trips would make the panel four times slower to
   * fill for a list nobody reads past the first screen of. `allSettled`
   * rather than `all` because these windows are independent: if the 5m call
   * times out, the 24h ranking everyone actually looks at is already in hand
   * and losing the tail is not worth losing the list.
   */
  const responses = await Promise.allSettled(
    paths.map((path) =>
      fetch(`${url}/${path}${query}`, { headers, signal, next: { revalidate } }),
    ),
  );

  const ok = responses.filter(
    (r): r is PromiseFulfilledResult<Response> => r.status === "fulfilled" && r.value.ok,
  );
  /*
   * Every window failed — that is an outage, not a short list, and the caller
   * renders the two differently.
   *
   * The STATUS travels with it. "Jupiter tokens unavailable" is true and
   * useless; 429 means the allowance is spent and 503 means they are down,
   * and those want different reactions from whoever reads the log.
   */
  if (ok.length === 0) {
    const first = responses.find(
      (r): r is PromiseFulfilledResult<Response> => r.status === "fulfilled",
    );
    throw new DiscoverError(
      first ? `Jupiter tokens returned ${first.value.status}` : "Jupiter tokens unreachable",
    );
  }

  const pages = await Promise.all(ok.map((r) => r.value.json().catch(() => [])));

  /*
   * Deduplicated by MINT, first sighting wins.
   *
   * The windows overlap heavily — 6h adds about 22 tokens to 24h's hundred —
   * and the same token appearing twice in a market list is the kind of thing
   * that makes a panel look broken. Keeping the first means keeping the
   * position it held in the most established ranking.
   */
  const seen = new Set<string>();
  const tokens: TokenInfo[] = [];
  for (const page of pages) {
    for (const row of Array.isArray(page) ? page : []) {
      if (typeof row !== "object" || row === null) continue;
      const t = fromJupiter(row as Record<string, unknown>);
      if (!t.mint || seen.has(t.mint)) continue;
      seen.add(t.mint);
      tokens.push(t);
    }
  }

  const kept = lifecycle ? tokens.filter((t) => t.lifecycle === lifecycle) : tokens;
  return kept.slice(0, limit);
}

/**
 * A token a minute old has no history to judge it by, so judge the dev.
 *
 * `risks()` in tokens.ts answers "is this the token you meant" — it is aimed
 * at the impostor problem, and leans on holders and liquidity, both of which
 * are meaningless at two minutes old. This answers a different question:
 * knowing this is brand new, what is already wrong with it.
 *
 * Returned as sentences rather than a score. A number invites the user to
 * treat 71 as better than 68; a sentence says what it actually saw.
 */
export function launchRisks(token: TokenInfo): string[] {
  const out: string[] = [];
  const a = token.audit;

  /*
   * devMints ONLY MEANS SOMETHING WHILE NOTHING ELSE DOES.
   *
   * Run against live data this warning fired on USELESS — $214M market cap,
   * 61,272 holders — claiming its dev had minted 814 tokens, and on STONK at
   * $183M with 8,343. Those numbers are almost certainly a launchpad's shared
   * deployer rather than one person's rug factory, and it does not matter
   * which: a token with sixty thousand holders has been judged by the market
   * already, and a scary sentence attached to it is simply false.
   *
   * On a token still on its curve there IS nothing else — no holders worth
   * counting, no liquidity, no history — so the dev's record is the only fact
   * available and it is the right one to lead with. The moment real holders
   * exist, it stops being evidence and starts being noise.
   */
  const mints = a?.devMints;
  if (token.lifecycle === "bonding" && mints !== null && mints !== undefined && mints > 10) {
    out.push(
      `This dev has minted ${mints} tokens. Nobody launches ${mints} honest projects.`,
    );
  }
  if (a?.mintAuthorityDisabled === false) {
    out.push("Mint authority is still live — more supply can be created at will.");
  }
  if (a?.freezeAuthorityDisabled === false) {
    out.push("Freeze authority is still live — your balance can be frozen.");
  }
  if (a?.devBalancePercentage !== null && a?.devBalancePercentage !== undefined) {
    if (a.devBalancePercentage > 20) {
      out.push(`The dev holds ${a.devBalancePercentage.toFixed(1)}% of supply.`);
    }
  }
  if (token.lifecycle === "bonding") {
    out.push(
      "Still on its bonding curve. There is no pool yet — the only buyers are the curve's.",
    );
  }
  return out;
}
