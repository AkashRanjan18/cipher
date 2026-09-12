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
    };
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
   * STOP — "stop the rest at -50%", "stop at -50%", "stop loss at 40%"
   * The sign is ignored: "stop at 50%" and "stop at -50%" mean the same thing,
   * and nobody has ever meant a stop 50% above their entry.
   */
  const stop = text.match(
    /\bstop(?:\s+loss)?\s+(?:(the rest|rest|everything|all|a third|a half|half|[\d.]+\s*%)\s+)?(?:at|@)\s*-?\s*([\d.]+)\s*%/,
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

  /* TRAILING STOP — "trail 30%", "trailing stop 30%" */
  const trail = text.match(/\btrail(?:ing)?(?:\s+stop)?\s+(?:at\s+)?([\d.]+)\s*%/);
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
