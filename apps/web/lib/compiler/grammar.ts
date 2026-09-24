import {
  ORDER_SPEC_VERSION,
  DEFAULTS,
  type Amount,
  type ExitRule,
  type OrderSpec,
  type Trigger,
  newId,
} from "@cipher/shared";

/**
 * The deterministic parser.
 *
 * Handles the sentences people actually type, without a model: under 10ms, no
 * network, no cost, and no chance of a misread. The model only sees what this
 * cannot parse.
 *
 * That split matters for more than money. The model is the only component
 * that can misunderstand an instruction, so the less traffic it sees, the
 * fewer opportunities exist to sell the wrong thing.
 *
 * Returns null when it isn't confident — never a half-parse. A partially
 * understood order is more dangerous than an unparsed one, because the
 * readback would look plausible.
 */

/*
 * A timestamp plus a per-page counter was not unique across USERS. Two people
 * arming a rule in the same millisecond, both with the counter at zero after a
 * page load, produced the same id — and in Postgres that id is a primary key
 * across everybody, with `on conflict do nothing` behind it.
 */
const nextId = () => newId("r");

/** "500", "1,500", "1.5k", "2m" → number */
function parseNumber(raw: string): number | null {
  const m = raw.trim().toLowerCase().replace(/,/g, "").match(/^([\d.]+)\s*([km])?$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  return m[2] === "k" ? n * 1_000 : m[2] === "m" ? n * 1_000_000 : n;
}

/**
 * "The rest" — a placeholder, never a real percentage.
 *
 * It was 100, which read as "all of it" and made "sell 30% at 2x and stop the
 * rest at -50%" a stop for the WHOLE position. Now that percentages freeze
 * into token counts when an order is placed, that stop would need 100% of
 * the tokens after the ladder had already sold 30% — and a sell never
 * executes short, so the stop protecting the position could never fire.
 * resolveRest() turns this into what the sentence meant: whatever the other
 * exits leave behind.
 */
const REST = -1;

/** Words people use instead of percentages. */
const FRACTIONS: Record<string, number> = {
  half: 50,
  "a half": 50,
  third: 33,
  "a third": 33,
  quarter: 25,
  "a quarter": 25,
  all: 100,
  everything: 100,
  "the rest": REST,
  rest: REST,
};

function parseAmount(raw: string): Amount | null {
  const s = raw.trim().toLowerCase();

  const frac = FRACTIONS[s.replace(/^(sell|of)\s+/, "")];
  if (frac !== undefined) return { kind: "percentOfPosition", value: frac };

  const pct = s.match(/^([\d.]+)\s*%$/);
  if (pct) {
    const v = Number(pct[1]);
    if (v > 0 && v <= 100) return { kind: "percentOfPosition", value: v };
    return null;
  }

  const usd = s.match(/^\$\s*([\d.,]+\s*[km]?)$/);
  if (usd) {
    const v = parseNumber(usd[1]);
    return v && v > 0 ? { kind: "usd", value: v } : null;
  }

  return null;
}

/**
 * "2x", "3.5x" → priceMultiple
 *
 * Accepts ANY positive multiple, including ones below 1. That looks wrong and
 * is not: a take-profit at 0.8x is a real sentence with a real mistake in it,
 * and this used to reject it silently — the exit never entered the spec, the
 * readback said "no exit is armed", and the user was never told that the thing
 * they asked for had been dropped.
 *
 * The grammar parses. validate.ts judges. Swallowing an instruction is the one
 * thing neither of them is allowed to do.
 */
function parseMultiple(s: string): Trigger | null {
  const m = s.match(/^([\d.]+)\s*x$/i);
  if (!m) return null;
  const v = Number(m[1]);
  return v > 0 ? { kind: "priceMultiple", value: v } : null;
}

export function parseWithGrammar(input: string): OrderSpec | null {
  const text = input.trim().toLowerCase();
  if (!text) return null;

  const exits: ExitRule[] = [];
  let entry: OrderSpec["entry"] = null;

  /*
   * ENTRY — "buy $500 of bonk", "buy me $500 bonk"
   * The token is captured as whatever word follows; resolving it to a mint is
   * a separate step that needs network, so the grammar stays offline.
   */
  /*
   * BOTH SIDES. This read `\bbuy\b` for months, so "sell $200 of SOL" matched
   * nothing here, fell through to the token-denominated branch — which needs a
   * bare number and saw a dollar sign — and came out as "I didn't get that".
   * cipher could buy a dollar amount and could not sell one, which is half an
   * order book missing on the commonest sentence anybody types.
   */
  /*
   * THE VERBS PEOPLE ACTUALLY USE. "ape $200 into bonk" and "get me $100 of
   * wif" are not slang at the edges — they are how this is said out loud, and
   * both refused. `into` matters as much as the verbs: it is the preposition
   * that goes with aping, and without it the token was never captured.
   */
  const buy = text.match(
    /*
     * THE TOKEN IS NEVER A CONNECTIVE. `in` is an optional preposition here,
     * so "put ten bucks in and cut me if it drops ten percent" — a sentence
     * that names no token at all — captured "and" as the coin and armed a
     * $10 buy of it. Adding `put` as a verb is what exposed this; the same
     * hole was always there behind "buy $10 in and …".
     *
     * Failing to match is the right outcome: with no entry, compile.ts sees
     * a dollar figure the parse did not use and hands the whole sentence to
     * the model rather than answering with half an order.
     */
    /\b(buy|sell|ape|grab|cop|get\s+me|dump|put)\s+(?:me\s+)?(\$\s*[\d.,]+\s*[km]?)\s+(?:of\s+|worth\s+of\s+|into\s+|in\s+)?(?!(?:and|then|once|when|if|at|with|for|to|the|an|my|it|is|in|into|of|worth)\b)([a-z0-9]{2,15})\b/,
  );
  if (buy) {
    const amount = parseAmount(buy[2]);
    if (!amount) return null;
    /* Every verb here opens a position except the two that close one. */
    const closes = /^(sell|dump)$/.test(buy[1]);
    entry = {
      side: closes ? "sell" : "buy",
      token: buy[3],
      mint: null,
      amount,
      slippageBps: DEFAULTS.slippageBps,
      privateSubmission: DEFAULTS.privateSubmission,
      priority: DEFAULTS.priority,
      tipSol: DEFAULTS.tipSol,
      trigger: null,
    };
  }

  /*
   * ENTRY, DENOMINATED IN TOKENS — "buy 500 tokens of bonk", "sell 1.5 sol"
   *
   * The dollar form above is the common one, but this is the OTHER half of
   * the ambiguity the router detects: "buy 500 solana" is either $500 of SOL
   * or 500 SOL, and a clarify option that rewrites it as tokens has to parse.
   * Without this the clarified sentence came back as a refusal — the question
   * was asked, answered, and then thrown away.
   *
   * Guarded against the units that mean something else: a bare "%" is a size
   * of a position, "x" is a multiple, and neither is a token count. The
   * lookahead excludes unit WORDS too — without it "buy 500 dollars of solana"
   * parsed as five hundred tokens of a coin called "dollars", which is the
   * kind of bug that is funny until it fills.
   */
  /*
   * THE WHOLE POSITION — "sell my position on SOL", "close my bonk", "dump
   * all my sol", "sell everything".
   *
   * A hundred percent OF THE POSITION, not a token count, because the size is
   * only known when the order runs: a stop could have taken half of it in the
   * meantime, and a spec carrying the quantity read at arm time would try to
   * sell tokens that are no longer there.
   *
   * It comes before the sized branch on purpose. "sell all my sol" has no
   * number in it at all, so nothing below would ever have matched it — this
   * was the second of the four plainest sentences a person types that cipher
   * could not read.
   */
  if (!entry) {
    /*
     * A SIZE RELATIVE TO THE POSITION — "sell half of my SOL", "sell 25% of
     * my bonk", "sell all my sol", "close my bonk", "sell my position on SOL".
     *
     * Percent OF THE POSITION, not a token count, because the size is only
     * known when the order runs: a stop could take half of it in between, and
     * a spec carrying the quantity read at arm time would try to sell coins
     * that are no longer there.
     *
     * TWO PATTERNS, NOT ONE WITH EVERYTHING OPTIONAL. The first version made
     * every part optional and matched far more than it should have — "sell a
     * third at two x" came out as selling 33% of a token called "at", because
     * after the fraction the next word-shaped thing was a preposition. So a
     * named fraction now REQUIRES an "of" or a "my" between it and the token,
     * which every real phrasing has and no stray match does.
     */
    const frac = text.match(
      /\b(?:sell|close|dump|exit)\s+(?:(?:a|the)\s+)?(?:(half|third|quarter|rest|all|everything)|([\d.]+)\s*%)\s+(?:of\s+)?(?:my\s+)?(?:(?:entire|whole)\s+)?([a-z][a-z0-9]{1,14})\b/,
    );

    /*
     * The whole position with no fraction named. Gated on a marker, because
     * without one "sell solana" was a full liquidation from two words — no
     * number, no question, the position gone. "Sell" alone says nothing about
     * size; it is the commonest incomplete order there is, and it belongs in
     * the branch that asks how much.
     */
    /*
     * "MY" IS A MARKER TOO. "Sell my SOL" names the position as surely as
     * "sell my position on SOL" does — the possessive is the whole point of
     * saying it — and without it here "sell my sol when it reaches 150" asked
     * how much, having just been told.
     *
     * "Sell SOL" still asks, and the difference between the two is exactly one
     * word, which is the right place for the line: one of them refers to
     * something the user holds and the other names a market.
     */
    const closing =
      /\b(close|dump|exit)\b/.test(text) ||
      /\b(my\s+position|entire|whole)\b/.test(text) ||
      /\b(?:sell|close|dump|exit)\s+my\s+[a-z]/.test(text);
    const whole = closing
      ? text.match(
          /\b(?:sell|close|dump|exit)\s+(?:my\s+)?(?:(?:entire|whole)\s+)?(?:position\s+(?:on|in)\s+)?(?:my\s+)?([a-z][a-z0-9]{1,14})\b/,
        )
      : null;

    const named = frac?.[3] ?? whole?.[1] ?? null;
    const STOPWORD = /^(?:it|everything|all|them|position|my|the|rest|half|third|quarter|at|in|on|of|to|for|and|when|if|out)$/;

    if (named && !STOPWORD.test(named)) {
      const pct = frac?.[2] ? Number(frac[2]) : null;
      const percent = frac?.[1]
        ? (FRACTIONS[frac[1]] ?? null)
        : pct != null && pct > 0 && pct <= 100
          ? pct
          : whole
            ? 100
            : null;

      if (percent != null) {
        entry = {
          side: "sell",
          token: named,
          mint: null,
          amount: { kind: "percentOfPosition", value: percent },
          slippageBps: DEFAULTS.slippageBps,
          privateSubmission: DEFAULTS.privateSubmission,
          priority: DEFAULTS.priority,
          tipSol: DEFAULTS.tipSol,
          trigger: null,
        };
      }
    }
  }

  /*
   * THE SIZE AND THE TOKEN AT OPPOSITE ENDS OF THE SENTENCE.
   *
   * "Sell everything if SOL goes below 80" names the size first and the token
   * six words later, joined by the condition — so every pattern that expects
   * them adjacent missed it, and cipher asked what price to trigger at while
   * the number sat at the end of the sentence it had just read.
   *
   * Only the whole-position words qualify. A fraction this far from its token
   * is ambiguous about which position it is a fraction OF, and guessing that
   * is guessing at what gets sold.
   */
  if (!entry) {
    const split = text.match(
      /\b(?:sell|dump|close|exit)\s+(?:everything|all|it|out)\b.*?\b(?:if|when|once|after)\s+(?:the\s+)?([a-z][a-z0-9]{1,14})\b/,
    );
    const named = split?.[1];
    if (named && !/^(?:it|the|price|market|we|i|you|they|this|that)$/.test(named)) {
      entry = {
        side: "sell",
        token: named,
        mint: null,
        amount: { kind: "percentOfPosition", value: 100 },
        slippageBps: DEFAULTS.slippageBps,
        privateSubmission: DEFAULTS.privateSubmission,
        priority: DEFAULTS.priority,
        tipSol: DEFAULTS.tipSol,
        trigger: null,
      };
    }
  }

  if (!entry) {
    /*
     * THE SAME VERBS AS THE DOLLAR BRANCH. This read `\b(buy|sell)\b` while
     * the branch above took buy|sell|ape|grab|cop|get me|dump, so a token
     * count said with any of the other five lost its entry — and only its
     * entry. "grab 5 tokens of btc and sell at 150000" kept the exit and
     * dropped the buy, arming a sell against a position nobody had opened.
     * compile.ts' half-read guard could not see it either: that looks for a
     * "$" amount the parse did not use, and "5 tokens" has no "$" in it.
     *
     * One list, said twice, and the second copy went stale. Found by the
     * corpus, 23 Sep 2026 — it was the whole of the remaining 7.3%.
     */
    const sized = text.match(
      /\b(buy|sell|ape|grab|cop|get\s+me|dump|put)\s+(?:me\s+)?([\d.,]+)\s*(?:tokens?\s+(?:worth\s+of\s+|of\s+|into\s+)?|coins?\s+of\s+|of\s+|into\s+)?(?!dollars?\b|usd\b|bucks?\b|worth\b|tokens?\b|coins?\b)([a-z][a-z0-9]{1,14})\b/,
    );
    if (sized && !/^[\d.,]+\s*[%x]/.test(sized[0].replace(/^\w+\s+(?:me\s+)?/, ""))) {
      const value = Number(sized[2].replace(/,/g, ""));
      if (value > 0) {
        entry = {
          /* Every verb here opens a position except the two that close one —
             the same test the dollar branch makes. */
          side: /^(sell|dump)$/.test(sized[1]) ? "sell" : "buy",
          token: sized[3],
          mint: null,
          amount: { kind: "tokens", value },
          slippageBps: DEFAULTS.slippageBps,
          privateSubmission: DEFAULTS.privateSubmission,
          priority: DEFAULTS.priority,
          tipSol: DEFAULTS.tipSol,
          trigger: null,
        };
      }
    }
  }

  /*
   * A RESTING ENTRY — "buy $500 of SOL at $95", "sell 2 SOL @ 120"
   *
   * The difference between this and a market order is one word, and the
   * difference in what happens is total: a limit order does not exist until
   * the price arrives. On an AMM there is no book to rest it in, so the
   * trigger engine holds it and fires a market swap on the crossing — and what
   * makes it a real limit rather than a delayed market order is that the
   * swap's minimumOutAmount comes from THIS price.
   *
   * The lookahead is doing real work. "at 2x" is a multiple and "at 50%" is a
   * drawdown; both are exits and both would otherwise be read here as a price
   * of two dollars and fifty dollars. A price is a bare number or a dollar
   * amount, and nothing else.
   */
  if (entry) {
    /*
     * "AT" IS NOT THE ONLY WORD FOR IT. People say a resting price four ways
     * and only one of them uses "at": below, under, above, over, "when it
     * hits", "if it drops to", "once it reaches". "Sell everything if SOL goes
     * below 80" asked "what price should this trigger at?" — a question whose
     * answer was the last word of the sentence.
     *
     * The lookahead still excludes `x` and `%`, because "at 2x" is a multiple
     * and "at 50%" is a drawdown, and reading either as a price in dollars is
     * how a take-profit becomes a limit order at two dollars.
     */
    /*
     * ONLY THE ENTRY'S OWN CLAUSE. This searched the whole sentence, so in
     * "buy 5 sol, sell 30% at $95, sell 100% at $135" the first price anywhere
     * — the stop's — became the BUY's limit: a market buy the user asked for
     * turned into a resting order at $95. The clause ends at the first comma,
     * semicolon, "and", "then" or "once"; everything after that belongs to
     * the exits.
     */
    const limit = entryClause(text).match(
      /\b(?:at|@|below|under|above|over|to|hits?|reaches|touches)\s*\$?\s*([\d.,]+)\b(?!\s*[x%])/,
    );
    if (limit) {
      const at = Number(limit[1].replace(/,/g, ""));
      if (at > 0) entry.trigger = { kind: "priceAbsolute", value: at };
    }
  }

  /* SLIPPAGE — "max 3% slippage", "3% slippage" */
  const slip = text.match(/(?:max\s+)?([\d.]+)\s*%\s*slippage/);
  if (slip && entry) {
    const pct = Number(slip[1]);
    if (pct > 0 && pct <= 100) entry.slippageBps = Math.round(pct * 100);
  }

  /* ROUTING — an explicit opt-out of the private default */
  if (/\bpublic\s+(?:submission|mempool)\b/.test(text) && entry) {
    entry.privateSubmission = false;
  }
  if (/\b(private|protected)\s+(?:submission|mempool)\b|\bvia\s+jito\b/.test(text) && entry) {
    entry.privateSubmission = true;
  }

  /*
   * PRIORITY — "high priority fee", "turbo", "fast", "max priority".
   *
   * One of the five knobs the whole prompt bar exists for, and one of the two
   * the grammar used to drop on the floor: the sentence asked for a high
   * priority fee, the order armed with an ordinary one, and the readback said
   * nothing about it.
   */
  if (entry) {
    if (/\b(turbo|max(?:imum)?\s+priority|ultra)\b/.test(text)) entry.priority = "turbo";
    else if (/\b(high|higher|fast|faster|urgent|aggressive)\b.{0,20}\b(priority|fee|speed)\b/.test(text))
      entry.priority = "high";
    else if (/\bpriority\b.{0,20}\b(high|turbo|max)\b/.test(text)) entry.priority = "high";
    else if (/\b(low|slow|cheap|minimum|min)\b.{0,20}\b(priority|fee)\b/.test(text))
      entry.priority = "normal";
  }

  /*
   * JITO TIP — "with a 0.001 sol tip", "tip 0.002", "0.005 sol tip".
   *
   * A real number rather than a name, because a tip is a direct bid against
   * the other bundles in the same auction and "0.001 SOL" means that.
   */
  const tip = text.match(
    /\b(?:tip(?:ping)?\s+(?:of\s+)?)?([\d.]+)\s*sol\s+tip\b|\btip\s+(?:of\s+)?([\d.]+)\s*(?:sol)?\b/,
  );
  if (tip && entry) {
    const v = Number(tip[1] ?? tip[2]);
    /* An upper bound, because a fat-fingered "tip 5" is five SOL to a builder
       for a $20 trade. validate.ts warns; this refuses the absurd outright. */
    if (v > 0 && v <= 1) entry.tipSol = v;
  }

  /*
   * TAKE PROFIT — "sell a third at 2x", "sell 50% at 3x", "take profit at 2x"
   * Global regex: a sentence can carry several, and a ladder is the point.
   */
  /*
   * ONLY THE FIRST RUNG CARRIES THE VERB, and anchoring on it lost the rest.
   *
   * "sell 25% at 2x and 25% at 5x" is one sentence with two rungs, and the
   * second has no "sell" in front of it — nobody repeats the verb. The old
   * pattern required one per rung, so it armed the 2x, dropped the 5x without
   * a word, and the readback showed a ladder with one step. A ladder losing
   * half of itself is the quietest way to change what somebody asked for.
   *
   * The verb still has to appear SOMEWHERE, or "at 2x" in any sentence at all
   * would arm an exit against a position nobody mentioned.
   */
  if (/\b(sell|take\s+profit)\b/.test(text)) {
    for (const m of text.matchAll(
      /(?:(a third|a half|half|third|quarter|a quarter|all|everything|the rest|rest|[\d.]+\s*%|\$\s*[\d.,]+\s*[km]?)\s+)?(?:at|@)\s*([\d.]+)\s*x\b/g,
    )) {
      const trigger = parseMultiple(`${m[2]}x`);
      if (!trigger) continue;
      // Bare "take profit at 2x" with no size means the whole position.
      const amount = m[1] ? parseAmount(m[1]) : { kind: "percentOfPosition" as const, value: 100 };
      if (!amount) continue;
      exits.push({ id: nextId(), trigger, amount });
    }
  }

  /*
   * TAKE PROFIT AT A PRICE — "sell half at $200", "take profit at $250"
   *
   * The multiple form above only matches "at 2x". A trader who knows the
   * number they want is more likely to say it than to do the division, and
   * the Trigger union has had priceAbsolute in it the whole time — the
   * grammar simply had no way to produce one for an exit.
   *
   * A DOLLAR SIGN IS REQUIRED. "sell half at 200" with no marker is the same
   * ambiguity as "buy 500 solana": two hundred dollars or two hundred percent
   * or a multiple. Requiring the marker means this only fires when the user
   * was explicit, and the bare form falls through to the router's clarify.
   */
  for (const m of text.matchAll(
    /*
     * A PRONOUN MAY SIT BETWEEN THE SIZE AND THE PRICE — "sell 70% OF IT at
     * 1300". The price had to follow the size immediately, so the exit was
     * dropped entirely from an order whose buy parsed perfectly. Reported
     * live, 23 Sep 2026.
     *
     * ONLY A PRONOUN, and the restriction is the whole point. "of it" refers
     * back to something bought in the same sentence, so it is an exit. "sell
     * half OF MY SOL at 300" names a holding, and that is a resting sell —
     * which the entry branch above already builds as an entry with a trigger.
     * Accepting both spellings here armed BOTH: the same instruction became a
     * resting sell AND a duplicate exit at the same price, selling 50% twice.
     * Caught by the corpus, which went from 100% on exits to 97.9%.
     */
    /* `it` may lead the size — "sell IT ALL at 0.0042", which is how it is
       said out loud and how the microphone delivered it on 24 Sep 2026. The
       exit was dropped outright: nothing in the pattern could consume "it"
       before the size, so the match failed and the target never existed. */
    /\b(?:sell|take profit(?:\s+on)?)\s+(?:it\s+)?(?:(a third|a half|half|third|quarter|a quarter|all|everything|the rest|rest|[\d.]+\s*%)\s+)?(?:of\s+(?:it|them|that|these|those)\s+)?(?:at|@)\s*(\$)?\s*([\d.,]+)\b(?!\s*[x%.\d])/g,
  )) {
    /*
     * A BARE PRICE IS A PRICE, with or without a size in front of it.
     *
     * "sell 30% at 100" has always been read. "sell at 100" was not — the $
     * was required when no size came first — and the target was then dropped
     * in SILENCE: "buy $500 of sol and sell at 300" armed the buy, armed no
     * exit, and said nothing about the half of the sentence it discarded.
     * 486 of 5,085 corpus rows, and every one of them a stated take-profit
     * that never existed.
     *
     * The ambiguity that justified the $ is not there. `x` and `%` are both
     * excluded by the lookahead on this same pattern, so a bare number after
     * "at" has only one reading left, and the two rules below already read it
     * that way for "stop at 180" and "target 300". A target was the only
     * exit in the file that demanded a currency marker its siblings did not.
     *
     * A price far from the market is validate.ts' job, and it does it.
     */
    const at = Number(m[3].replace(/,/g, ""));
    if (!(at > 0)) continue;
    const amount = m[1] ? parseAmount(m[1]) : { kind: "percentOfPosition" as const, value: 100 };
    if (!amount) continue;
    exits.push({ id: nextId(), trigger: { kind: "priceAbsolute", value: at }, amount });
  }

  /*
   * THE NEXT RUNG WITHOUT ITS VERB — "sell 30% at $100 and 70% at $95", "…
   * and the rest at $95", "… and rest of 70% at $95".
   *
   * Nobody repeats "sell" (the same fact the multiple ladder above allows
   * for). Found live, 19 Sep 2026: the second rung was dropped without a word,
   * so a user who asked to sell everything in two steps armed one step. Only
   * after a clause break, only once "sell" appears somewhere, and only with a
   * size or "the rest" before the price — so "and stop at $80" is left to the
   * stop pattern below.
   */
  if (/\bsell\b/.test(text)) {
    for (const m of text.matchAll(
      /(?:,|\band\b|\bthen\b)\s+(?:the\s+)?(?:(rest|remaining)\s*(?:of\s+)?)?(?:([\d.]+\s*%)\s+)?(?:at|@)\s*\$?\s*([\d.,]+)\b(?!\s*[x%.\d])/g,
    )) {
      if (!m[1] && !m[2]) continue;
      const at = Number(m[3].replace(/,/g, ""));
      if (!(at > 0)) continue;
      if (exits.some((x) => x.trigger.kind === "priceAbsolute" && x.trigger.value === at)) continue;
      /* An explicit percentage wins over "the rest" — "rest of 70%" is 70. */
      const amount = m[2] ? parseAmount(m[2]) : parseAmount("the rest");
      if (!amount) continue;
      exits.push({ id: nextId(), trigger: { kind: "priceAbsolute", value: at }, amount });
    }
  }

  /*
   * STOP — "stop the rest at -50%", "stop at -50%", "stop loss on SOL at 10%"
   * The sign is ignored: "stop at 50%" and "stop at -50%" mean the same thing,
   * and nobody has ever meant a stop 50% above their entry.
   *
   * THE LOOKBEHIND IS NOT OPTIONAL. "trailing stop at 10%" contains the exact
   * string "stop at 10%", so without it that sentence parsed as TWO exits — a
   * drawdown and a trailing stop, both for the whole position. The user would
   * have been sold twice: once at -10% from entry, and again by a stop they
   * never asked for. Found by running the user's own example through it.
   *
   * The token group lets a market be named mid-sentence ("stop loss on solana
   * at 10%"). It excludes "at" explicitly, or that word would be eaten as the
   * token and the trigger would never be found.
   */
  const stop = text.match(
    /*
     * "Cut my losses at -15%" and "stop me out if it drops 25%" are stops.
     * Both refused, and a refused stop is the one refusal that costs money —
     * the user believes the position is protected and nothing is watching it.
     *
     * `my` and `me out` are allowed between the verb and the level, and `if
     * it drops` joins `at` as a way of naming one.
     */
    /(?<!\btrail\s)(?<!\btrailing\s)\b(?:stop|cut)(?:\s+my)?(?:\s+losses?)?(?:\s+loss)?(?:\s+me\s+out)?(?:\s+(?:on\s+)?(the rest|rest|everything|all|a third|a half|half|[\d.]+\s*%))?(?:\s+(?:on\s+)?(?!at\b|if\b)[a-z][a-z0-9]{1,14})?\s*(?:at|@|of|to|if\s+it\s+(?:drops?|falls?)(?:\s+by)?)\s*-?\s*([\d.]+)\s*%/,
  );
  if (stop) {
    const percent = Number(stop[2]);
    if (percent > 0 && percent < 100) {
      const amount = stop[1] ? parseAmount(stop[1]) : { kind: "percentOfPosition" as const, value: 100 };
      if (amount) {
        exits.push({
          id: nextId(),
          trigger: { kind: "drawdownFromEntry", percent },
          amount,
        });
      }
    }
  }

  /*
   * STOP AND TARGET AT A PRICE — "stop loss to 80", "stop at $80", "target
   * price 100", "target $100".
   *
   * The user's own Case II sentence — "once bought, set a stop loss to 80 and
   * a target price to 100" — parsed as NOTHING: the stop above only knows
   * percentages, and "target" was not a word the grammar had. Both exits were
   * dropped without a sound, which is the one thing this file may never do.
   *
   * A bare number is allowed here, unlike "sell half at $200": after "stop
   * loss" or "target" a number with no % and no x can only be a price.
   */
  for (const m of text.matchAll(
    /(?<!\btrail\s)(?<!\btrailing\s)\b(stop(?:\s+loss)?|sl|target(?:\s+price)?|tp)(?:\s+(?:on\s+)?(the rest|rest|everything|all|a third|a half|half|[\d.]+\s*%))?\s*(?:at|@|to|of|is|=)?\s*\$?\s*(\d[\d.,]*)\b(?!\s*[x%.\d])/g,
  )) {
    const at = Number(m[3].replace(/,/g, ""));
    if (!(at > 0)) continue;
    /* Already there as "take profit at $100" or "sell all at $100". */
    if (exits.some((x) => x.trigger.kind === "priceAbsolute" && x.trigger.value === at)) continue;
    const amount = m[2] ? parseAmount(m[2]) : { kind: "percentOfPosition" as const, value: 100 };
    if (!amount) continue;
    exits.push({ id: nextId(), trigger: { kind: "priceAbsolute", value: at }, amount });
  }

  /* TRAILING STOP — "trail 30%", "trailing stop 30%", "trailing stop loss at 10%" */
  const trail = text.match(
    /* "trail my sol by 40%" — the token and the "by" both sat between the
       verb and the number, and neither was allowed for. */
    /\btrail(?:ing)?(?:\s+stop)?(?:\s+loss)?(?:\s+my)?(?:\s+(?!at\b|by\b)[a-z][a-z0-9]{1,14})?\s*(?:at\s+|by\s+)?([\d.]+)\s*%/,
  );
  if (trail) {
    const percent = Number(trail[1]);
    if (percent > 0 && percent < 100) {
      exits.push({
        id: nextId(),
        trigger: { kind: "trailingStop", percent },
        amount: { kind: "percentOfPosition", value: 100 },
      });
    }
  }

  // Nothing recognised at all — hand it to the model rather than guess.
  if (!entry && exits.length === 0) return null;

  resolveRest(entry, exits);

  return {
    version: ORDER_SPEC_VERSION,
    entry,
    exits,
    source: "grammar",
    warnings: [],
  };
}

/**
 * The part of the sentence that describes the entry: from its verb to the
 * first clause break. Every single-clause order is its own entry clause.
 */
function entryClause(text: string): string {
  /*
   * THE VERB LIST LIVES IN THREE PLACES and has now drifted twice in one day:
   * here, the dollar entry, and the token entry. Keep them in step — a verb
   * missing from THIS one is the worst of the three, because `search` then
   * finds the first verb it does know, which is the EXIT's. "put $500 into
   * sol and sell at 300" skipped to "sell at 300", read it as the entry
   * clause, and armed a resting buy at the take-profit price — the order
   * rested at 300 instead of filling now, and the same 300 was also its
   * target. Found by the corpus, 23 Sep 2026.
   */
  const verb = text.search(/\b(?:buy|sell|ape|grab|cop|get\s+me|dump|put|close|exit)\b/);
  const from = verb < 0 ? text : text.slice(verb);

  /*
   * AN EXIT WORD ENDS THE ENTRY CLAUSE, PUNCTUATION OR NOT.
   *
   * This split on commas, semicolons, "and", "then" and "once" — all the marks
   * of a written sentence. Spoken ones have none of them. Reported live, 24
   * Sep 2026, from the microphone:
   *
   *   "buy me $5 of pump set a stop loss at 0.0038 and sell it all at 0.0042"
   *
   * The first "and" is in front of "sell", so the entry clause ran all the way
   * through the stop — and the buy took 0.0038 as its own limit price. A
   * market buy became a resting order at the stop level, the stop armed at the
   * same price, and the 0.0042 target disappeared. Three errors from one
   * missing comma.
   *
   * Searched from index 1 so a sentence that OPENS with "sell" is not cut at
   * its own first word.
   */
  const cut = from
    .slice(1)
    .search(/,|;|\band\b|\bthen\b|\bonce\b|\bset\s+a\b|\bstop\b|\btarget\b|\btake\s+profit\b|\bsell\b|\btrail/);
  return cut < 0 ? from : from.slice(0, cut + 1);
}

/**
 * "The rest" becomes 100 minus every other exit's share.
 *
 * "Sell a third at 2x, stop the rest at -50%" → 33 and 67. On an entry there
 * are no siblings to subtract, so "sell the rest of my sol" is all of it.
 * If the other exits already claim everything, the rest is also taken as
 * 100 — the validator then refuses the oversell and says why, which beats
 * silently arming a stop for nothing.
 */
function resolveRest(entry: OrderSpec["entry"], exits: ExitRule[]): void {
  const isRest = (a: Amount) => a.kind === "percentOfPosition" && a.value === REST;
  if (entry && isRest(entry.amount)) entry.amount = { kind: "percentOfPosition", value: 100 };

  /*
   * A RESTING SELL CLAIMS ITS SHARE TOO.
   *
   * "sell 70% of my PUMP at 0.0042 and the rest at 0.0048" puts the 70% in
   * the ENTRY — a resting sell is an entry with a trigger — so the exits were
   * empty when "the rest" was resolved and it came back 100%. The ladder then
   * sold 70% and then everything. Reported live, 23 Sep 2026.
   */
  const claimedByEntry =
    entry && entry.side === "sell" && entry.amount.kind === "percentOfPosition" && !isRest(entry.amount)
      ? entry.amount.value
      : 0;

  const claimed = exits
    .filter((x) => x.amount.kind === "percentOfPosition" && !isRest(x.amount))
    .reduce((sum, x) => sum + x.amount.value, claimedByEntry);
  const left = 100 - claimed;
  for (const x of exits) {
    if (isRest(x.amount)) x.amount = { kind: "percentOfPosition", value: left > 0 ? left : 100 };
  }
}
