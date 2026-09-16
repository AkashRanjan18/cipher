import { INTENT_VERSION, type Amount, type Compiled, type OrderSpec } from "@cipher/shared";

/**
 * An order with a hole in it asks for the missing piece.
 *
 * THE DIFFERENCE BETWEEN THIS AND A REFUSAL IS THE WHOLE POINT. "Buy SOL at
 * $95" is not a sentence cipher failed to understand — it is understood
 * completely, and it is short one number. Answering it with "I didn't get
 * that" is a lie about what happened, and it makes the user retype a sentence
 * that was already nearly right. Answering it with "how much?" costs them one
 * word.
 *
 * WHAT A MARKET ORDER NEEDS, and what a resting one needs on top:
 *
 *     market      side, token, amount                    fills now
 *     limit       + the price it rests at
 *     stop        + the level, absolute or as a drawdown
 *     trailing    + how far behind the high it follows
 *
 * A market order is easy because the price is whatever the market says at the
 * moment it runs, so there is nothing to ask. Everything else has a number
 * that only the user knows, and the engine cannot arm a rule around a number
 * nobody supplied. The choice is to ask or to invent, and inventing a stop
 * level is inventing the price at which somebody's position gets sold.
 *
 * IT NEVER GUESSES AND IT NEVER HALF-PARSES. What comes back is a question
 * plus a TEMPLATE — the same sentence with `{}` where the answer goes. The
 * answer is substituted, and the completed sentence is compiled from scratch
 * through the same grammar, the same validation and the same readback as
 * anything typed by hand. Nothing here builds a spec.
 *
 * ONE HOLE AT A TIME, in the order below. Two questions at once is a form,
 * and the reason cipher has a prompt bar is that it is not a form. When a
 * sentence is missing two things the first answer produces a sentence that is
 * missing one, and the same machinery asks again.
 */

/* ── the vocabulary ──────────────────────────────────────────────────────── */

/** Words that open a position. `short` is here to be REFUSED, not filled. */
const BUY = /\b(buy|bought|buying|ape|aping|long|get\s+me|grab|cop)\b/;
const SELL = /\b(sell|selling|sold|dump|dumping|close|exit|offload|unload)\b/;

/**
 * A condition was stated and no number came with it.
 *
 * This is the load-bearing one. "Buy $500 of SOL when it dips" used to parse
 * as a MARKET order — the grammar read the side, the size and the token, found
 * no price after "at", and returned an entry with `trigger: null`. So a
 * sentence whose entire point was "not yet" bought immediately, at whatever
 * the price happened to be, and the readback said so in a line nobody reads
 * twice. A sentence that says "when" and has no number is incomplete, never
 * immediate.
 */
const CONDITION =
  /\b(when|once|if|after|as\s+soon\s+as|dips?|drops?|falls?|hits?|reaches|rises?|pumps?|breaks?|limit|resting)\b/;

/*
 * `rest` is deliberately NOT in there, though "a resting order" is exactly the
 * thing this detects. "Sell the rest of my SOL" is a complete market order —
 * the commonest way anyone says "close what is left" — and listing the bare
 * word turned it into "what price should the sell trigger at?", which is a
 * question about a condition the sentence never contained.
 */

/** Somewhere to stop out. */
const STOP = /\b(stop|stop\s*-?\s*loss|sl|cut|bail)\b/;
/** A stop that follows the price up. */
const TRAIL = /\b(trail|trailing)\b/;

/** Any number at all — dollars, bare, percent, multiple, k/m suffixed. */
const HAS_NUMBER = /\d/;
/** A size the grammar would accept without asking. */
const HAS_SIZE =
  /(\$\s*[\d.,]+|[\d.,]+\s*%|\b\d[\d.,]*\s*[km]?\b|\b(half|third|quarter|all|everything|the\s+rest|my\s+position|entire|whole)\b)/;

/**
 * The token, as the user said it. Resolving it to a mint needs the network,
 * so like the rest of the grammar this stays offline and hands on a word.
 */
const NOISE = new Set([
  "buy", "sell", "me", "my", "a", "an", "the", "of", "at", "to", "for", "on",
  "in", "when", "it", "if", "once", "some", "all", "worth", "dollars", "dollar",
  "usd", "bucks", "tokens", "token", "coins", "coin", "position", "and", "with",
  "please", "now", "current", "market", "price", "limit", "order", "stop",
  "loss", "trail", "trailing", "half", "third", "quarter", "everything", "rest",
  "dips", "dip", "drops", "drop", "falls", "fall", "hits", "hit", "reaches",
  "rises", "rise", "pumps", "pump", "breaks", "break", "out", "off", "high",
  "from", "down", "up", "goes", "go", "gets", "get", "around", "about", "under",
  "over", "below", "above", "back", "more", "less", "than", "then", "that",
  "this", "is", "are", "was", "be", "am", "i", "want", "like", "would", "could",
  "should", "can", "will", "shall", "do", "does", "did", "have", "has", "had",
  /*
   * THE VERBS THEMSELVES. Every word that can open or close a position has to
   * be here, or it becomes the token: "put a limit buy on solana for $500"
   * built the template "buy $500 of PUT at {}", because `put` was simply the
   * first word not on this list. The question would have been asked about a
   * coin that does not exist.
   */
  "set", "place", "put", "add", "arm", "create", "make", "order", "orders",
  "into", "some", "ape", "aping", "grab", "cop", "long", "bought", "buying",
  "selling", "sold", "dump", "dumping", "exit", "offload", "unload", "close",
  "cut", "bail", "trail", "trailing", "sl", "bot", "leave", "let",
]);

function tokenIn(text: string): string | null {
  for (const w of text.split(/[^a-z0-9]+/)) {
    if (w.length < 2 || w.length > 15) continue;
    if (NOISE.has(w)) continue;
    if (/^\d/.test(w)) continue;
    return w;
  }
  return null;
}

function ask(
  question: string,
  template: string,
  expects: "price" | "percent" | "size",
  example: string,
  options: { label: string; sentence: string }[] = [],
): Compiled {
  return {
    version: INTENT_VERSION,
    intent: { kind: "clarify", question, options, fill: { template, expects, example } },
    source: "grammar",
    warnings: [],
  };
}

/** An Amount back into the words that produced it, so a template reads right. */
function amountWords(a: Amount): string {
  if (a.kind === "usd") return `$${a.value}`;
  if (a.kind === "tokens") return `${a.value}`;
  return a.value === 100 ? "all" : a.value === 50 ? "half" : `${a.value}%`;
}

/* ── the detector ────────────────────────────────────────────────────────── */

/**
 * The sentence said WHEN and the grammar found no price — so it built a market
 * order out of an instruction that explicitly asked for a delay.
 *
 * This is the one case where the grammar succeeding is worse than it failing.
 * "Buy $500 of SOL when it dips" produced `trigger: null`, which means fill
 * immediately, at whatever the price is right now, which is the precise
 * opposite of what was asked. Nothing was refused and nothing was flagged; the
 * order simply went through as a market buy.
 *
 * Only when there are no exits attached. A compound sentence — "buy $500 of
 * bonk, sell half at 2x, stop at -50%" — cannot be rebuilt from a template
 * without dropping the ladder, and silently losing a stop to fix a trigger
 * would be trading one version of this bug for a worse one.
 */
export function askForMissingTrigger(text: string, spec: OrderSpec): Compiled | null {
  const e = spec.entry;
  if (!e || e.trigger !== null) return null;
  if (spec.exits.length > 0) return null;
  if (!CONDITION.test(text)) return null;

  const size = amountWords(e.amount);
  const of = e.amount.kind === "percentOfPosition" ? `my ${e.token}` : `of ${e.token}`;
  return ask(
    `What price should the ${e.side} trigger at?`,
    `${e.side} ${size} ${of} at {}`,
    "price",
    "$95",
    [{ label: "Actually, fill it now", sentence: `${e.side} ${size} ${of} at the current price` }],
  );
}

/**
 * Called only after the strict grammar has declined the sentence, so anything
 * reaching here is already known not to be a complete order. Returns null when
 * the sentence is not order-shaped at all, and the router carries on to the
 * matchers that handle questions, navigation and screens.
 */
export function askForMissing(text: string): Compiled | null {
  const buying = BUY.test(text);
  const selling = SELL.test(text);
  const trailing = TRAIL.test(text);
  const stopping = STOP.test(text);

  if (!buying && !selling && !trailing && !stopping) return null;

  const token = tokenIn(text);

  /*
   * A PRICE IS NOT A SIZE, and "buy SOL at $95" contains only a price.
   *
   * Testing the raw sentence for a size found "$95" and concluded the order
   * was fully specified, so the one case this module exists for — a limit
   * order with no quantity — fell straight through to "I didn't get that".
   * The trigger clause comes out before the question is asked. `2x` and `50%`
   * survive the strip because those are exits, not prices.
   */
  const withoutPrice = text.replace(/\b(?:at|@)\s*\$?\s*[\d.,]+\s*[km]?\b(?!\s*[x%])/g, " ");
  const size = HAS_SIZE.test(withoutPrice);

  /*
   * TRAILING STOP, no distance. Asked before the plain stop because "trailing
   * stop" contains "stop", and a trailing stop with a fixed level is not a
   * trailing stop — it is an ordinary one wearing the wrong name.
   */
  if (trailing && !HAS_NUMBER.test(text)) {
    return ask(
      "How far behind the high should it follow?",
      "trail {} off the high",
      "percent",
      "30%",
      [
        { label: "20%", sentence: "trail 20% off the high" },
        { label: "30%", sentence: "trail 30% off the high" },
        { label: "50%", sentence: "trail 50% off the high" },
      ],
    );
  }

  /* STOP, no level. */
  if (stopping && !HAS_NUMBER.test(text)) {
    return ask(
      token ? `Where should the stop on ${token} sit?` : "Where should the stop sit?",
      "stop at {}",
      "percent",
      "-20%",
      [
        { label: "-20%", sentence: "stop at -20%" },
        { label: "-30%", sentence: "stop at -30%" },
        { label: "-50%", sentence: "stop at -50%" },
      ],
    );
  }

  if (!buying && !selling) return null;
  if (!token) return null;

  const side = buying ? "buy" : "sell";

  /*
   * NO SIZE. Asked before the price, because the size is what decides whether
   * there is an order at all — a price with nothing behind it is a price alert,
   * which is a different product.
   *
   * Whatever was already said about WHEN is carried into the template intact,
   * so answering "how much" does not quietly throw away the condition. Selling
   * gets the position-relative options a buy cannot have.
   */
  if (!size) {
    /*
     * WHATEVER WAS SAID ABOUT *WHEN* SURVIVES THE QUESTION.
     *
     * Carrying only an explicit "at $95" was not enough: "buy solana when it
     * dips" produced the template "buy {} of solana", so answering "$500"
     * compiled a sentence with no condition left in it and bought at market.
     * The question about size silently deleted the instruction not to trade
     * yet — the same bug as the one above, arriving one turn later.
     *
     * The rest of the sentence from the condition word onward is kept
     * verbatim, so the recompile sees the condition again and asks for the
     * price it still does not have.
     */
    const when = text.match(/\b(?:at|@)\s*\$?\s*([\d.,]+)\b(?!\s*[x%])/);
    const cond = text.match(CONDITION);
    const tail = when
      ? ` at $${when[1]}`
      : cond?.index != null
        ? ` ${text.slice(cond.index).trim()}`
        : "";
    return ask(
      `How much ${token} do you want to ${side}?`,
      `${side} {} of ${token}${tail}`,
      "size",
      side === "buy" ? "$500" : "half",
      side === "sell"
        ? [
            { label: "All of it", sentence: `sell all my ${token}${tail}` },
            { label: "Half", sentence: `sell half of my ${token}${tail}` },
            { label: "A third", sentence: `sell a third of my ${token}${tail}` },
          ]
        : [],
    );
  }

  /*
   * A SIZE AND A CONDITION AND NO PRICE. The sentence says it should not
   * happen yet, and does not say what it waits for.
   */
  if (CONDITION.test(text)) {
    const amount = withoutPrice.match(HAS_SIZE)?.[0]?.trim() ?? "";
    return ask(
      `What price should the ${side} trigger at?`,
      `${side} ${amount} of ${token} at {}`,
      "price",
      "$95",
    );
  }

  return null;
}
