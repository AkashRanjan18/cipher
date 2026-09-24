/**
 * The token registry: every tradeable token, with both of its scales.
 *
 * ONE FILE, READ CLIENT-SIDE, so the prompt bar can correct a word while the
 * user is still speaking. A network round trip per keystroke is not a thing
 * you can do at dictation speed, and the whole point of the correction is that
 * it happens before the sentence is finished. `scripts/registry/build.ts`
 * writes `public/tokens.json`; this file is everything that reads it.
 *
 * IT CARRIES PRICE *AND* CAP, and that pairing is what makes two features
 * possible that neither number can do alone:
 *
 *   "buy zcat at 3.4 million"   3.4M is nowhere near a $0.004 price and sits
 *                               exactly on the market cap. It is a cap, and
 *                               the price it implies is cap ÷ supply.
 *   "buy solana at 120"         120 is a price. The cap is nine orders of
 *                               magnitude away and could not be meant.
 *
 * A trader says both and means both, usually without noticing which one they
 * used. Reading only prices makes every cap sentence a wild limit order miles
 * from the market; reading only caps does the reverse. The scale is decided by
 * which number the one they said is closer to, and refused when it is neither.
 */

import { SIDES } from "../compiler/verbs.ts";

export interface RegistryToken {
  mint: string;
  /** "SOL" */
  symbol: string;
  /** Jupiter's name, which is often not the one people say: SOL is "Wrapped SOL". */
  name: string;
  /**
   * The other things people call it.
   *
   * "Solana" does not appear anywhere in the SOL token's own metadata — its
   * symbol is SOL and its name is "Wrapped SOL" — so the commonest word a
   * person could possibly say for it matched nothing at all. A token has as
   * many names as people have ways of saying it, and only the registry can
   * know them.
   */
  aliases?: string[];
  /** USD per token. */
  price: number;
  /** What a trader means by market cap — `displayCap()` picks fdv over mcap. */
  cap: number | null;
  decimals: number;
  verified: boolean;
}

export interface Registry {
  /** ISO. A stale registry prices orders off yesterday's market. */
  generatedAt: string;
  tokens: RegistryToken[];
}

/* ───────────────────────────── saying a name ───────────────────────────── */

/** Lowercase, no "$", letters and digits only — "$BONK" and "bonk!" are one word. */
export function flatten(said: string): string {
  return said.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Levenshtein, iterative with one row.
 *
 * Small and dependency-free because it runs over the whole registry on every
 * keystroke. The two-row form is enough: we never need the edit script, only
 * the distance.
 */
function distance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[b.length];
}

/**
 * How far a word may be from a name and still be the same word.
 *
 * Proportional to length, because one wrong letter in "sol" is a third of the
 * word and one wrong letter in "ethereum" is nothing. A recogniser that heard
 * "sulana" for "solana" is one substitution out; a user who typed a different
 * token is not.
 */
function tolerance(word: string): number {
  return word.length <= 4 ? 1 : Math.floor(word.length / 4) + 1;
}

export interface Match {
  token: RegistryToken;
  /** 0 is exact. Higher is further. */
  distance: number;
  /** Which field matched — useful for explaining the correction. */
  on: "symbol" | "name" | "alias";
}

/**
 * The token a spoken or typed word most likely names.
 *
 * VERIFIED FIRST, ALWAYS. Anyone can mint a token called SOL with the same
 * logo for a couple of dollars, and fuzzy matching is exactly the door that
 * lets one in — a near-miss on a name is how the impostor gets picked over
 * the real thing. Unverified tokens are only considered when nothing verified
 * comes close, and `resolveToken()` in lib/chain/tokens.ts still has the final
 * word before anything is armed.
 *
 * Returns null rather than a bad guess. A miss costs one retype; the wrong
 * mint costs the position.
 */
export function nearest(said: string, tokens: RegistryToken[]): Match | null {
  const q = flatten(said);
  if (!q) return null;

  const pool = tokens.some((t) => t.verified) ? tokens.filter((t) => t.verified) : tokens;

  let best: Match | null = null;
  let runnerUp = Infinity;

  for (const token of pool) {
    const fields: [string, Match["on"]][] = [
      [token.symbol, "symbol"],
      [token.name, "name"],
      ...(token.aliases ?? []).map((a) => [a, "alias"] as [string, Match["on"]]),
    ];
    for (const [raw, on] of fields) {
      const candidate = flatten(raw);
      if (!candidate) continue;
      const d = distance(q, candidate);
      if (best === null || d < best.distance) {
        runnerUp = best?.distance ?? runnerUp;
        best = { token, distance: d, on };
      } else if (token.mint !== best.token.mint && d < runnerUp) {
        runnerUp = d;
      }
    }
  }

  if (!best || best.distance > tolerance(q)) return null;
  /*
   * A TIE IS NOT A MATCH. Two tokens the same distance from what was said
   * means the word does not identify one of them, and picking the first in
   * the list is picking by Jupiter's sort order — which is not a fact about
   * what the user meant.
   */
  if (best.distance > 0 && runnerUp === best.distance) return null;
  return best;
}

/* ──────────────────────────── price or market cap ──────────────────────── */

export type Scale =
  | { kind: "price"; price: number }
  /** The price the stated cap implies: cap ÷ supply, and supply is cap ÷ price. */
  | { kind: "cap"; price: number; cap: number }
  | { kind: "neither" };

/**
 * An order of magnitude of daylight before either reading wins.
 *
 * A stop 50% below the market is 0.3 decades from the price; a 10x target is
 * 1. A market cap is nine to twelve decades away from a memecoin's price, so
 * in practice the two readings are never close — and when they somehow are,
 * "neither" is the honest answer and the compiler asks.
 */
const DECISIVE_DECADES = 1;

/**
 * Past this, a number is neither reading and the compiler should ask.
 *
 * Found in the live registry: NOVBEAR trades at $1.65e-8 with a $33 market
 * cap, so EVERY number a person could say is astronomically far from both —
 * and with only a relative comparison, "0.004" was read as a market cap and
 * silently became a price of 2e-12. Three decades is a thousandfold, which is
 * a generous resting order and still nowhere near an accident.
 */
const MAX_DECADES = 3;

/**
 * Did the sentence SAY which scale it meant?
 *
 * The chart header can be showing price or market cap, and the user is free
 * to speak in either regardless of which one is up (the user's rule, 23 Sep
 * 2026) — so the open window is never consulted. What IS consulted is whether
 * they named the scale out loud, and when they did, that settles it: cipher
 * transcribes an instruction rather than second-guessing one. The magnitude
 * test below is only for sentences that leave it unsaid.
 *
 * "mc" and "cap" are in because that is how it is typed in a chat; "at a
 * price of" and "per token" are the two ways people disambiguate downward.
 */
export function statedScale(text: string): "price" | "cap" | null {
  const t = text.toLowerCase();
  if (/\b(market\s*cap|marketcap|mcap|mkt\s*cap|\bmc\b|\bcap\b|valuation|fdv)\b/.test(t)) {
    return "cap";
  }
  if (/\b(price|per\s+token|per\s+coin|a\s+token|each)\b/.test(t)) return "price";
  return null;
}

/**
 * Was that number a price or a market cap?
 *
 * Decided by distance on a log scale, because the question is never "is 3.4
 * million a lot" — it is "which of this token's two numbers is it near". That
 * works identically for a token at $0.000004 and one at $100,000, which is the
 * range cipher has to span.
 */
export function readScale(
  said: number,
  token: RegistryToken,
  /** What the sentence said, when it said. Overrides the magnitude test. */
  stated: "price" | "cap" | null = null,
): Scale {
  if (!(said > 0)) return { kind: "neither" };
  const { price, cap } = token;

  /*
   * A NAMED SCALE IS NOT A GUESS TO SECOND-GUESS. "buy zcat at 3.4 million
   * market cap" is unambiguous however far 3.4M sits from anything, and
   * overriding it because the arithmetic looks surprising would be cipher
   * exercising judgement about an instruction it was given plainly. A cap
   * that cannot be converted — no cap figure for this token — is refused
   * rather than quietly re-read as a price.
   */
  if (stated === "cap") {
    if (!cap || !(cap > 0) || !(price > 0)) return { kind: "neither" };
    return { kind: "cap", price: (said * price) / cap, cap: said };
  }
  if (stated === "price") return { kind: "price", price: said };

  const toPrice = price > 0 ? Math.abs(Math.log10(said / price)) : Infinity;
  const toCap = cap && cap > 0 ? Math.abs(Math.log10(said / cap)) : Infinity;

  if (toPrice === Infinity && toCap === Infinity) return { kind: "neither" };
  /* Neither reading is remotely plausible: say so rather than picking the
     less absurd of two absurdities. */
  if (Math.min(toPrice, toCap) > MAX_DECADES) return { kind: "neither" };

  if (toPrice + DECISIVE_DECADES < toCap) return { kind: "price", price: said };
  if (toCap + DECISIVE_DECADES < toPrice) {
    /* supply = cap / price, so the implied price is said × price / cap. The
       division is written this way to avoid rounding a huge supply figure. */
    const implied = (said * price) / cap!;
    return { kind: "cap", price: implied, cap: said };
  }
  return { kind: "neither" };
}

/* ───────────────────────── the chart is the scope ──────────────────────── */

export type Against =
  /** Trade it — the word named the token already on screen. */
  | { kind: "open"; token: RegistryToken }
  /** The word was a mishearing of the open token; show the correction. */
  | { kind: "corrected"; token: RegistryToken; heard: string }
  /** A different, real token. cipher will not trade it from this chart. */
  | { kind: "elsewhere"; token: RegistryToken }
  | { kind: "unknown" };

/**
 * What a spoken token name means while a chart is open.
 *
 * THE OPEN CHART IS THE SCOPE (the user's rule, 23 Sep 2026). An order is
 * placed against the market on screen, so a word that nearly names it is a
 * mishearing to be corrected, and a word that clearly names something else is
 * a different market the user has to open first.
 *
 * WHY THE CORRECTION IS SAFE, and it needs stating because "snap the token to
 * whatever is on screen" is otherwise how somebody buys the wrong mint: the
 * corrected word is written back into the prompt bar and the user reads it
 * before pressing Enter. It is a spelling suggestion, not a decision. The
 * moment this runs anywhere the correction is not visible before it executes,
 * this function is the wrong tool.
 *
 * `elsewhere` is deliberately not a silent switch. Changing the chart out from
 * under a sentence is how "buy $500" lands on a token nobody was looking at.
 */
export function against(said: string, open: RegistryToken, tokens: RegistryToken[]): Against {
  const q = flatten(said);
  if (!q) return { kind: "unknown" };

  if (q === flatten(open.symbol) || q === flatten(open.name)) return { kind: "open", token: open };

  /*
   * The open token gets a wider tolerance than the rest of the registry,
   * because context is evidence: with ZCAT on screen, "zcash" is far likelier
   * to be a recogniser slip than a sudden change of market. One extra edit,
   * not a blank cheque — "ethereum" is nowhere near "zcat" at any tolerance.
   */
  const toOpen = Math.min(distance(q, flatten(open.symbol)), distance(q, flatten(open.name)));
  if (toOpen <= tolerance(q) + 1) return { kind: "corrected", token: open, heard: said };

  const other = nearest(said, tokens);
  return other ? { kind: "elsewhere", token: other.token } : { kind: "unknown" };
}

/* ────────────────────────── correcting a sentence ──────────────────────── */

/**
 * Where a token name sits in an order.
 *
 * ONLY THE TOKEN SLOT IS EVER TOUCHED. A correction that scanned every word
 * would rewrite "cut" or "rest" into whatever coin they resemble, and the
 * whole value of this is that the user can trust what appears in the bar. So
 * the word has to follow a verb and its size, exactly where the grammar looks
 * for it — a near-miss anywhere else is left alone and refused later, which
 * costs a retype instead of a position.
 */
const TOKEN_SLOT = new RegExp(
  `\\b(?:${SIDES})\\s+(?:me\\s+)?(?:\\$?\\s*[\\d.,]+\\s*%?\\s*[km]?\\s*(?:tokens?|coins?)?\\s*)?` +
    `(?:half|a\\s+third|a\\s+quarter|all|everything|the\\s+rest\\s+)?\\s*` +
    `(?:worth\\s+of\\s+|of\\s+|into\\s+|in\\s+)?(?:my\\s+|the\\s+)?([a-z][a-z0-9]{1,14})\\b`,
  "i",
);

export interface Correction {
  /** The sentence to show, corrected. */
  text: string;
  /** What was changed, for the note under the bar. Null when nothing was. */
  changed: { from: string; to: string } | null;
  /** Set when the sentence named a real token that is not the open one. */
  elsewhere: RegistryToken | null;
}

/**
 * Rewrite a misheard token name to the one on screen.
 *
 * FOR SPEECH, NOT FOR TYPING. A recogniser hands over a finished sentence and
 * this fixes it before the user reads it; rewriting words under a moving
 * cursor would fight whoever is typing them. The user sees the corrected
 * sentence in the bar and presses Enter — which is the whole safety argument
 * for snapping a name to the open chart, and the reason this must never run
 * anywhere the result is not shown before it executes.
 */
export function correctSentence(
  said: string,
  open: RegistryToken | null,
  tokens: RegistryToken[],
): Correction {
  const none: Correction = { text: said, changed: null, elsewhere: null };
  if (!open) return none;

  const m = said.match(TOKEN_SLOT);
  if (!m) return none;

  const heard = m[1];
  const verdict = against(heard, open, tokens);

  if (verdict.kind === "corrected") {
    /* Replaced at its own offset, not by a global replace: the same letters
       can appear elsewhere in the sentence, and "sell 30% of my sol at 200"
       must not have its size or its price rewritten. */
    const at = said.lastIndexOf(heard, (m.index ?? 0) + m[0].length);
    return {
      text: said.slice(0, at) + verdict.token.symbol + said.slice(at + heard.length),
      changed: { from: heard, to: verdict.token.symbol },
      elsewhere: null,
    };
  }
  if (verdict.kind === "elsewhere") return { ...none, elsewhere: verdict.token };
  return none;
}
