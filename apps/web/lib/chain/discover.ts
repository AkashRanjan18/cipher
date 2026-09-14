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
export const FEEDS = {
  new: "recent",
  traded: "toptraded/24h",
  organic: "toporganicscore/24h",
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
  const path = FEEDS[feed];
  const query = feed === "new" ? "" : `?limit=${ask}`;

  const res = await fetch(`${url}/${path}${query}`, {
    headers,
    signal,
    next: { revalidate },
  });
  if (!res.ok) throw new DiscoverError(`Jupiter tokens returned ${res.status}`);

  const body = (await res.json()) as unknown;
  const rows = Array.isArray(body) ? body : [];

  const tokens = rows
    .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null)
    .map(fromJupiter)
    .filter((t) => t.mint);

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
