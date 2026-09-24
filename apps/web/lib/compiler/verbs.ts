/**
 * The words that open and close a position. One list, one file.
 *
 * WHY THIS EXISTS. This alternation was written out five separate times — the
 * dollar entry and the token entry in grammar.ts, entryClause() beside them,
 * `HAS_SIDE` in compile.ts, and the token slot in lib/market/registry.ts — and
 * on 23 and 24 September 2026 it caused four distinct bugs, every one of them
 * a copy that had fallen behind:
 *
 *   the token entry took only buy|sell, so "grab 5 tokens of btc and sell at
 *   150000" kept the exit and dropped the buy — arming a sell against a
 *   position nobody had opened
 *
 *   entryClause did not know "put", so `search` found the first verb it DID
 *   know, which was the exit's: "put $500 into sol and sell at 300" read
 *   "sell at 300" as the entry clause and rested the buy at the target price
 *
 *   and today, spoken aloud, "BUYING $100 of solana and set a stop loss at
 *   $114" was refused outright. Deepgram heard it perfectly. No copy of the
 *   list had ever contained an inflected form, so the commonest way a person
 *   narrates their own action — "buying", "selling" — parsed as nothing.
 *
 * INFLECTIONS ARE NOT OPTIONAL. Typed, people write "buy". Spoken, they say
 * "buying this" and "I'm selling half" as readily as the bare imperative, and
 * a voice-first prompt bar that only understands the imperative understands
 * half of what it is told.
 *
 * Strings rather than regexes, because each caller embeds them differently —
 * some capture the verb, some do not, one needs a lookbehind in front. A
 * shared RegExp object would also carry shared `lastIndex` state between the
 * `g`-flagged callers, which is its own quiet bug.
 */

/** Words that open a position. */
export const OPENS =
  "buy|buying|bought|purchase|purchasing|ape|aping|grab|grabbing|cop|get\\s+me|put|putting";

/** Words that close one. */
export const CLOSES = "sell|selling|sold|dump|dumping|offload|unload";

/** Either. The order matters: longer forms first, or "buy" wins before "buying". */
export const SIDES = `${OPENS}|${CLOSES}`;

/**
 * Does this verb close a position rather than open one?
 *
 * Anchored, and given the matched verb rather than the sentence — "sell" as a
 * substring of a longer sentence says nothing about which verb was captured.
 */
export function closesPosition(verb: string): boolean {
  return new RegExp(`^(?:${CLOSES})$`).test(verb.trim().toLowerCase());
}
