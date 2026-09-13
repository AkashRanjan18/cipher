import {
  ORDER_SPEC_VERSION,
  DEFAULTS,
  type Amount,
  type ExitRule,
  type OrderSpec,
  type Trigger,
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

let seq = 0;
const nextId = () => `r${Date.now().toString(36)}${(seq++).toString(36)}`;

/** "500", "1,500", "1.5k", "2m" → number */
function parseNumber(raw: string): number | null {
  const m = raw.trim().toLowerCase().replace(/,/g, "").match(/^([\d.]+)\s*([km])?$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  return m[2] === "k" ? n * 1_000 : m[2] === "m" ? n * 1_000_000 : n;
}

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
  "the rest": 100,
  rest: 100,
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
  const buy = text.match(
    /\bbuy\s+(?:me\s+)?(\$\s*[\d.,]+\s*[km]?)\s+(?:of\s+|worth\s+of\s+)?([a-z0-9]{2,15})\b/,
  );
  if (buy) {
    const amount = parseAmount(buy[1]);
    if (!amount) return null;
    entry = {
      side: "buy",
      token: buy[2],
      mint: null,
      amount,
      slippageBps: DEFAULTS.slippageBps,
      privateSubmission: DEFAULTS.privateSubmission,
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
  if (!entry) {
    const sized = text.match(
      /\b(buy|sell)\s+(?:me\s+)?([\d.,]+)\s*(?:tokens?\s+of\s+|coins?\s+of\s+|of\s+)?(?!dollars?\b|usd\b|bucks?\b|worth\b|tokens?\b|coins?\b)([a-z][a-z0-9]{1,14})\b/,
    );
    if (sized && !/^[\d.,]+\s*[%x]/.test(sized[0].replace(/^\w+\s+(?:me\s+)?/, ""))) {
      const value = Number(sized[2].replace(/,/g, ""));
      if (value > 0) {
        entry = {
          side: sized[1] as "buy" | "sell",
          token: sized[3],
          mint: null,
          amount: { kind: "tokens", value },
          slippageBps: DEFAULTS.slippageBps,
          privateSubmission: DEFAULTS.privateSubmission,
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
    const limit = text.match(/\b(?:at|@)\s*\$?\s*([\d.,]+)\b(?!\s*[x%])/);
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

  /*
   * TAKE PROFIT — "sell a third at 2x", "sell 50% at 3x", "take profit at 2x"
   * Global regex: a sentence can carry several, and a ladder is the point.
   */
  for (const m of text.matchAll(
    /\b(?:sell|take profit(?:\s+on)?)\s+(?:(a third|a half|half|third|quarter|a quarter|all|everything|[\d.]+\s*%|\$\s*[\d.,]+\s*[km]?)\s+)?(?:at|@)\s+([\d.]+\s*x)/g,
  )) {
    const trigger = parseMultiple(m[2].replace(/\s/g, ""));
    if (!trigger) continue;
    // Bare "take profit at 2x" with no size means the whole position.
    const amount = m[1] ? parseAmount(m[1]) : { kind: "percentOfPosition" as const, value: 100 };
    if (!amount) continue;
    exits.push({ id: nextId(), trigger, amount });
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
    /\b(?:sell|take profit(?:\s+on)?)\s+(?:(a third|a half|half|third|quarter|a quarter|all|everything|the rest|rest|[\d.]+\s*%)\s+)?(?:at|@)\s*\$\s*([\d.,]+)\b/g,
  )) {
    const at = Number(m[2].replace(/,/g, ""));
    if (!(at > 0)) continue;
    const amount = m[1] ? parseAmount(m[1]) : { kind: "percentOfPosition" as const, value: 100 };
    if (!amount) continue;
    exits.push({ id: nextId(), trigger: { kind: "priceAbsolute", value: at }, amount });
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
    /(?<!\btrail\s)(?<!\btrailing\s)\bstop(?:\s+loss)?(?:\s+(?:on\s+)?(the rest|rest|everything|all|a third|a half|half|[\d.]+\s*%))?(?:\s+(?:on\s+)?(?!at\b)[a-z][a-z0-9]{1,14})?\s*(?:at|@)\s*-?\s*([\d.]+)\s*%/,
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

  /* TRAILING STOP — "trail 30%", "trailing stop 30%", "trailing stop loss at 10%" */
  const trail = text.match(
    /\btrail(?:ing)?(?:\s+stop)?(?:\s+loss)?\s+(?:at\s+)?([\d.]+)\s*%/,
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

  return {
    version: ORDER_SPEC_VERSION,
    entry,
    exits,
    source: "grammar",
    warnings: [],
  };
}
