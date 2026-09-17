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

/**
 * WHERE A TOKEN IS IN ITS LIFE, which on Solana is most of what it is.
 *
 *   bonding    still on a launchpad's curve. No AMM pool exists yet; the
 *              "price" is a function of how much has been bought. Minutes old,
 *              usually worthless, occasionally the whole trade.
 *   graduated  it filled the curve and migrated to a real pool. This is the
 *              moment that matters — liquidity becomes real and the token
 *              stops being a closed system.
 *   legacy     never had a launchpad. SOL, BONK, JUP, the LSTs, the stables.
 *
 * Derived rather than stored: Jupiter reports `launchpad` and `graduatedAt`,
 * and the three states are exactly the combinations of those two. Inventing a
 * fourth field to hold what two existing fields already say is how the two
 * start disagreeing.
 */
export type Lifecycle = "bonding" | "graduated" | "legacy";

export interface TokenAudit {
  mintAuthorityDisabled: boolean | null;
  freezeAuthorityDisabled: boolean | null;
  /** Share of supply held by the top holders, 0-100. */
  topHoldersPercentage: number | null;
  devBalancePercentage: number | null;
  /**
   * How many tokens this dev has ever minted. THE SINGLE BEST RUG SIGNAL HERE.
   *
   * A two-minute-old pump.fun token pulled from /tokens/v2/recent while
   * writing this had a dev with 422 previous mints. Nobody launches 422 honest
   * projects. Holder count and liquidity describe the token; this describes
   * the person, and the person is what repeats.
   */
  devMints: number | null;
}

/**
 * The four windows the panel offers.
 *
 * 5M · 1H · 4H · 1D, as the reference lays them out. THREE OF THE FOUR COME
 * STRAIGHT FROM JUPITER and the fourth does not: Jupiter reports 5m, 1h, 6h
 * and 24h, and no free feed checked so far carries a four-hour window —
 * DexScreener uses the identical m5/h1/h6/h24 set.
 *
 * So `4h` is a declared slot with no source behind it yet. Everything in it
 * renders as "—", which is the honest reading of "we do not have this",
 * against "0.00%", which would be a claim that the price did not move. The
 * layout is built; the feed is the open piece of work.
 */
export const WINDOWS = ["5m", "1h", "4h", "24h"] as const;
export type WindowKey = (typeof WINDOWS)[number];

/** Which Jupiter stats block backs each window. Null where nothing does yet. */
export const JUPITER_WINDOW: Record<WindowKey, string | null> = {
  "5m": "stats5m",
  "1h": "stats1h",
  "4h": null,
  "24h": "stats24h",
};

export interface TokenWindow {
  /** Percent, over the window. Null when there is no history to measure. */
  priceChangePct: number | null;
  buyVolumeUsd: number;
  sellVolumeUsd: number;
  /**
   * The same two with manufactured activity stripped out.
   *
   * Jupiter scores every trade for whether it looks like a real person or a
   * wash loop, and reports the honest subset separately. On SOL over 24h it is
   * $34M of $3.05B — about one percent — and on a token being pumped the gap
   * is the whole story: a coin can show nine figures of "volume" and a few
   * thousand dollars of anyone actually buying it.
   */
  buyOrganicUsd: number;
  sellOrganicUsd: number;
  /** Trade COUNTS, not people. */
  buys: number;
  sells: number;
  /**
   * WALLETS, split by side — and null until something reports them.
   *
   * Jupiter gives `numTraders`, one figure for both sides, plus `numNetBuyers`
   * and `numOrganicBuyers`. Those cannot be solved back into buyers and
   * sellers: a wallet that bought and then sold is in `numTraders` once and
   * belongs to both halves, so the system is underdetermined. DexScreener's
   * `txns` counts transactions, not wallets, so it is the same number as
   * `buys` and `sells` above under a different name.
   *
   * The row exists and reads "—" rather than showing trade counts relabelled
   * as people. "174 sells" and "100 sellers" are different claims about a
   * market and only one of them is on the screen.
   */
  buyers: number | null;
  sellers: number | null;
  /** Unique wallets that traded, both sides together. */
  traders: number;
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
  /** Price times CIRCULATING supply. Not what a trader means by "market cap". */
  mcap: number | null;
  /** Price times TOTAL supply. This is the one to show — see `displayCap`. */
  fdv: number | null;
  audit: TokenAudit | null;

  /* ── where it is in its life ─────────────────────────────────────────── */

  lifecycle: Lifecycle;
  /** "pump.fun", "letsbonk.fun", "met-dbc", … Null for legacy tokens. */
  launchpad: string | null;
  /** When it left the curve. Null while bonding, null for legacy. */
  graduatedAt: string | null;
  /** The dev's wallet. Pairs with audit.devMints to identify a serial launcher. */
  dev: string | null;
  /** When the token first existed. */
  createdAt: string | null;
  /** Traded volume and trader count over 24h, when Jupiter reports it. */
  volume24hUsd: number | null;
  traders24h: number | null;
  /** Percent move over 24h. Null, not zero, when there is no history to measure. */
  change24h: number | null;
  /** Jupiter's hosted icon. Null rather than a placeholder we invented. */
  icon: string | null;
  /**
   * Tokens in existence. The denominator behind `fdv`, shown beside it so
   * a reader can see what the valuation is a valuation OF.
   */
  totalSupply: number | null;
  /**
   * The same measurements over four periods, for the activity panel.
   *
   * Null for a window Jupiter did not report — a token minted four minutes ago
   * has no 24-hour history, and rendering zeroes there would say the opposite
   * of what is true: not "nothing traded", but "we do not know yet".
   */
  windows: Record<WindowKey, TokenWindow | null>;
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

/**
 * The three states, from the two fields that actually describe them.
 *
 * ORDER MATTERS: graduation is checked before bonding, because a graduated
 * token still carries the launchpad that made it. Reading `launchpad` alone
 * would file every graduated token as still on its curve — which is the
 * difference between a closed system and a real pool, and is exactly the
 * distinction a user is asking about when they ask for "graduated".
 */
export function lifecycleOf(raw: Record<string, unknown>): Lifecycle {
  if (!raw.launchpad) return "legacy";
  return raw.graduatedAt ? "graduated" : "bonding";
}

/**
 * A token's icon, routed away from gateways that refuse to serve it.
 *
 * Most launchpad metadata is pinned to IPFS and addressed through a public
 * gateway, and the two most common ones — ipfs.io and dweb.link — return 429
 * to us on a SINGLE cold request, not merely under load. Measured: fifteen of
 * twenty graduated tokens had an icon that would not load, every one of them
 * on those two hosts. On screen that is indistinguishable from a token with no
 * icon at all, so half the list wore a grey letter for no reason a user could
 * see.
 *
 * The CID is the content address and any gateway serves the same bytes, so
 * this swaps the host and nothing else. ipfs.filebase.io answered the same CID
 * in 0.49s where ipfs.io refused it outright.
 *
 * cipher: still someone else's uptime, and the honest fix is proxying icons
 * through our own route with a cache — one fetch per token for everyone,
 * immune to any single gateway. That needs SSRF guards (https only, no private
 * addresses, image content-types only), which is a piece of work rather than a
 * line, and it is worth doing before this is public.
 */
const DEAD_GATEWAYS = /^https:\/\/(ipfs\.io|dweb\.link)\/ipfs\//;
const GATEWAY = "https://ipfs.filebase.io/ipfs/";

export function normaliseIcon(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw) return null;
  return raw.replace(DEAD_GATEWAYS, GATEWAY);
}

/** One numeric field out of a stats block, null when it is not there. */
function field(stats: unknown, key: string): number | null {
  const v = (stats as Record<string, unknown> | undefined)?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** One of Jupiter's stats blocks → our shape. Null when the block is absent. */
function windowOf(stats: unknown): TokenWindow | null {
  const s = stats as Record<string, unknown> | undefined;
  if (!s) return null;
  const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    priceChangePct: typeof s.priceChange === "number" ? s.priceChange : null,
    buyVolumeUsd: n(s.buyVolume),
    sellVolumeUsd: n(s.sellVolume),
    buyOrganicUsd: n(s.buyOrganicVolume),
    sellOrganicUsd: n(s.sellOrganicVolume),
    buys: n(s.numBuys),
    sells: n(s.numSells),
    /* No source yet. `numTraders` is one figure for both sides and cannot be
       solved back into two — a wallet that bought then sold belongs to both. */
    buyers: null,
    sellers: null,
    traders: n(s.numTraders),
  };
}

/** Buy plus sell volume over a window. Jupiter reports the two sides apart. */
function volume(stats: unknown): number | null {
  const s = stats as Record<string, unknown> | undefined;
  if (!s) return null;
  const buy = typeof s.buyVolume === "number" ? s.buyVolume : 0;
  const sell = typeof s.sellVolume === "number" ? s.sellVolume : 0;
  return buy + sell;
}

/**
 * THE market cap, singular — what every screen prints under that label.
 *
 * Jupiter returns two numbers and they are nearly two different coins. For
 * PUMP on 16 Sep 2026, at a price both cipher and fomo agreed on to within
 * 0.14%:
 *
 *     mcap   $1.63B    price x circulating supply (468B)
 *     fdv    $2.90B    price x total supply       (834B)
 *
 * cipher was showing the first and fomo the second, which is how the same coin
 * read as $1.65B here and $2.9B there — a 1.76x disagreement on the number
 * people size positions with.
 *
 * FDV IS THE ONE TO SHOW, and not because fomo shows it. On a launchpad token
 * the whole supply is minted at once and most of it is already tradeable, so
 * "circulating" is a distinction inherited from equities that does not survive
 * contact with a memecoin. Every venue a cipher user also has open — pump.fun,
 * DexScreener, Photon, BullX — quotes FDV and calls it market cap. When
 * somebody says a coin is "at 2 million", this is the number they mean. Being
 * technically correct and alone by a factor of two is not correct: they would
 * reasonably conclude cipher's data is broken, and on this number they would
 * be the ones reading it right.
 *
 * It is one function rather than a field on each row because three screens
 * were each reaching for `mcap` on their own, which is how they would drift.
 */
export function displayCap(t: Pick<TokenInfo, "fdv" | "mcap">): number | null {
  /* Falls back rather than returning null: an old token whose total supply
     Jupiter does not carry still has a circulating figure worth printing, and
     a blank stat reads as a broken feed. */
  return t.fdv ?? t.mcap;
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
    fdv: typeof raw.fdv === "number" ? raw.fdv : null,
    lifecycle: lifecycleOf(raw),
    launchpad: raw.launchpad ? String(raw.launchpad) : null,
    graduatedAt: raw.graduatedAt ? String(raw.graduatedAt) : null,
    dev: raw.dev ? String(raw.dev) : null,
    createdAt: raw.createdAt ? String(raw.createdAt) : null,
    totalSupply: typeof raw.totalSupply === "number" ? raw.totalSupply : null,
    windows: {
      "5m": windowOf(raw.stats5m),
      "1h": windowOf(raw.stats1h),
      /* Declared, unsourced. Jupiter has 6h and no 4h; see WINDOWS. */
      "4h": null,
      "24h": windowOf(raw.stats24h),
    },
    volume24hUsd: volume(raw.stats24h),
    change24h: field(raw.stats24h, "priceChange"),
    icon: normaliseIcon(raw.icon),
    traders24h: field(raw.stats24h, "numTraders"),
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
          devMints: typeof audit.devMints === "number" ? audit.devMints : null,
        }
      : null,
  };
}
