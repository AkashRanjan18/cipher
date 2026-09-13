/**
 * Turning a word into a mint address.
 *
 * `Entry.mint` has been null since the compiler was written, and this is the
 * file that fills it. It is also the single most dangerous lookup in the
 * product, so it is pure, offline and tested: the network part lives in
 * app/api/token/route.ts and hands its results here.
 *
 * THE TRAP, WITH REAL DATA. Searching Jupiter for "BONK" today returns, among
 * twenty results:
 *
 *   Bonk     "Bonk"                 verified    1,016,962 holders   $1.03M liq
 *   BONK     "Bend Over Now, Kid"   unverified          2 holders   $2.31M liq
 *
 * The real token's symbol is `Bonk`. The impostor's is exactly `BONK`, it has
 * MORE liquidity than the real one, and two holders. So:
 *
 *   - exact symbol match picks the fake
 *   - highest liquidity picks the fake
 *   - most recently created picks the fake
 *
 * Minting a token with any name and logo costs a couple of dollars, and this
 * is the most common rug vector there is. The only thing that separates them
 * here is the verification flag and the organic-activity score, so those are
 * the filter — not a heuristic over the other numbers.
 */

export interface TokenAudit {
  mintAuthorityDisabled: boolean | null;
  freezeAuthorityDisabled: boolean | null;
  /** Share of supply held by the top holders, 0-100. */
  topHoldersPercentage: number | null;
  devBalancePercentage: number | null;
}

export interface TokenInfo {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  verified: boolean;
  /** Jupiter's measure of real versus manufactured activity, 0-100. */
  organicScore: number;
  holderCount: number;
  liquidityUsd: number;
  priceUsd: number;
  mcap: number | null;
  audit: TokenAudit | null;
}

export type Resolution =
  /** One token, confidently. */
  | { kind: "resolved"; token: TokenInfo }
  /** Several credible tokens. Ask; never pick. */
  | { kind: "ambiguous"; candidates: TokenInfo[] }
  /** Nothing worth trading. The reason is shown to the user. */
  | { kind: "none"; reason: string };

/**
 * Does this look like a mint address rather than a name?
 *
 * A pasted mint is UNAMBIGUOUS — it names exactly one token and needs no
 * search, no verification and no judgement. Anyone who has been rugged once
 * pastes addresses, and honouring that is both safer and faster than treating
 * it as a search term.
 *
 * Base58 excludes 0, O, I and l on purpose: the characters that look alike.
 */
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function looksLikeMint(query: string): boolean {
  return BASE58.test(query.trim());
}

/**
 * Enough real activity to be a real token.
 *
 * Not a rug detector — it is a "is anyone actually here" test. "Bend Over Now,
 * Kid" has two holders and no organic score; the millions of dollars of
 * apparent liquidity are the bait, not the evidence.
 */
const MIN_HOLDERS = 50;

/** Below this, two candidates are close enough that picking one is guessing. */
const DECISIVE_RATIO = 3;

export function resolveToken(query: string, results: TokenInfo[]): Resolution {
  const q = query.trim();
  if (!q) return { kind: "none", reason: "No token named." };

  /*
   * A pasted address wins outright, verified or not.
   *
   * Refusing an unverified mint the user typed in full would be cipher
   * deciding what they are allowed to buy — which is discretion, and not
   * cipher's to exercise. The risk flags below still apply; they inform
   * rather than block.
   */
  if (looksLikeMint(q)) {
    const exact = results.find((t) => t.mint === q);
    return exact
      ? { kind: "resolved", token: exact }
      : { kind: "none", reason: `I can't find any token at ${q.slice(0, 6)}…${q.slice(-4)}.` };
  }

  /*
   * VERIFIED ONLY, and this is the whole defence.
   *
   * Everything else — liquidity, recency, an exact symbol match — points at
   * the impostor in the BONK case above. Verification is the one signal an
   * attacker cannot mint their way into.
   */
  const credible = results.filter(
    (t) => t.verified && t.holderCount >= MIN_HOLDERS && t.liquidityUsd > 0,
  );

  if (credible.length === 0) {
    const near = results.find((t) => t.symbol.toLowerCase() === q.toLowerCase());
    return {
      kind: "none",
      reason: near
        ? `I found something calling itself ${near.symbol}, but it isn't verified` +
          (near.holderCount < MIN_HOLDERS ? ` and has ${near.holderCount} holders` : "") +
          `. Anyone can mint a token with that name, so I won't guess. Paste the mint address if you're sure.`
        : `I don't know a verified token called "${q}". Paste its mint address and I'll use that.`,
    };
  }

  /*
   * Rank by ORGANIC activity, not by size.
   *
   * Liquidity and market cap can both be manufactured — that is what the fake
   * BONK's $2.3M is. An organic score is Jupiter's read on whether the trading
   * is real, and holder count is expensive to fake at scale.
   */
  const ranked = [...credible].sort(
    (a, b) => b.organicScore - a.organicScore || b.holderCount - a.holderCount,
  );

  const [first, second] = ranked;

  /*
   * An exact symbol match among verified tokens settles it.
   *
   * Safe here in a way it is not before the verification filter: "bonksol" and
   * "letsbonk" are both verified and both real, and a user typing exactly one
   * of their symbols means that one.
   */
  const exact = ranked.filter((t) => t.symbol.toLowerCase() === q.toLowerCase());
  if (exact.length === 1) return { kind: "resolved", token: exact[0] };

  if (!second) return { kind: "resolved", token: first };

  /*
   * Close enough that choosing would be guessing.
   *
   * Three verified tokens answer to "bonk". Picking the biggest is a decision
   * about someone else's money made on a tiebreak, so it becomes a question
   * instead — the same shape as "$500 or 500 SOL".
   */
  const decisive =
    first.organicScore >= second.organicScore * DECISIVE_RATIO ||
    first.holderCount >= second.holderCount * DECISIVE_RATIO;

  return decisive
    ? { kind: "resolved", token: first }
    : { kind: "ambiguous", candidates: ranked.slice(0, 4) };
}

/**
 * What is worth saying out loud before someone buys this.
 *
 * Stated, never blocking. cipher transcribes an instruction; it does not
 * decide what a person may own. But "the issuer can still mint more of this"
 * is a fact they would want before, not after.
 */
export function risks(token: TokenInfo): string[] {
  const out: string[] = [];
  const a = token.audit;

  if (a?.mintAuthorityDisabled === false) {
    out.push("The issuer can still mint more of this token, diluting whatever you buy.");
  }
  if (a?.freezeAuthorityDisabled === false) {
    out.push("The issuer can freeze this token in your wallet — you may not be able to sell.");
  }
  if (a?.topHoldersPercentage !== null && a?.topHoldersPercentage !== undefined && a.topHoldersPercentage > 50) {
    out.push(`The top holders own ${a.topHoldersPercentage.toFixed(0)}% of supply between them.`);
  }
  if (!token.verified) {
    out.push("This token is not on Jupiter's verified list. Anyone can mint a lookalike.");
  }
  if (token.liquidityUsd > 0 && token.liquidityUsd < 25_000) {
    out.push(`Only ${Math.round(token.liquidityUsd).toLocaleString()} dollars of liquidity — a large order will move the price against you.`);
  }
  if (token.holderCount < MIN_HOLDERS) {
    out.push(`Only ${token.holderCount} holders.`);
  }
  return out;
}

/** Jupiter's search payload → our shape. Unknown fields are dropped, not trusted. */
export function fromJupiter(raw: Record<string, unknown>): TokenInfo {
  const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const audit = raw.audit as Record<string, unknown> | undefined;
  return {
    mint: String(raw.id ?? ""),
    symbol: String(raw.symbol ?? ""),
    name: String(raw.name ?? ""),
    decimals: n(raw.decimals),
    /* `isVerified` is absent rather than false on unverified tokens, so this
       must not be a truthiness check on a missing key. */
    verified: raw.isVerified === true,
    organicScore: n(raw.organicScore),
    holderCount: n(raw.holderCount),
    liquidityUsd: n(raw.liquidity),
    priceUsd: n(raw.usdPrice),
    mcap: typeof raw.mcap === "number" ? raw.mcap : null,
    audit: audit
      ? {
          mintAuthorityDisabled:
            typeof audit.mintAuthorityDisabled === "boolean" ? audit.mintAuthorityDisabled : null,
          freezeAuthorityDisabled:
            typeof audit.freezeAuthorityDisabled === "boolean" ? audit.freezeAuthorityDisabled : null,
          topHoldersPercentage:
            typeof audit.topHoldersPercentage === "number" ? audit.topHoldersPercentage : null,
          devBalancePercentage:
            typeof audit.devBalancePercentage === "number" ? audit.devBalancePercentage : null,
        }
      : null,
  };
}
