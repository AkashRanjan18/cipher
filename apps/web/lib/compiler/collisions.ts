import { compile } from "./compile.ts";

/**
 * Does a token's NAME change how a sentence parses?
 *
 * WHY THIS IS A THING AT ALL. The compiler's vocabulary and Solana's ticker
 * space overlap, and neither side knows about the other. `pumps?` is a
 * condition word; PUMP is a $3.7B token. So "buy $500 of PUMP" — a sentence
 * with no condition in it anywhere — read as one that says wait, and every
 * order on that token came back asking for a trigger price. It shipped, and a
 * user found it, which is the wrong way round.
 *
 * DIFFERENTIAL, NOT A KEYWORD LIST. The alternative is listing the reserved
 * words and checking tickers against it — which needs that list kept in step
 * with three regexes across two files, and stale copies of exactly that list
 * caused four separate bugs in one day. Comparing BEHAVIOUR against a control
 * token needs nothing kept in step with anything: if "buy $500 of PUMP" does
 * not do what "buy $500 of ZZQX" does, the name is the only difference and
 * therefore the cause.
 */

/** Meaningless on purpose: not a word, not a ticker, nothing to collide with. */
export const CONTROL = "zzqx";

/**
 * One sentence per thing an order can ask for.
 *
 * Deliberately few. This sweeps NAMES; corpus.jsonl already sweeps phrasing.
 * Crossing both would be 800,000 compiles to learn what 1,700 already say.
 */
export const SHAPES = [
  "buy $500 of {}",
  "buy $500 of {} at market price",
  "buy $500 of {} at the current price",
  "sell all my {}",
  "buy $500 of {} and stop at 10%",
  "buy $500 of {} and take profit at 2x",
  "buy $500 of {} when it drops to 1",
  "what is my {} position",
];

/**
 * Words the compiler treats as meaning something, swept as if they were
 * tickers.
 *
 * The live registry only covers what exists today, and a memecoin called DROP
 * is one afternoon away. PUMP belonged on this list in spirit and nobody had
 * written the list down.
 */
export const RESERVED = [
  "when", "once", "dip", "dips", "drop", "drops", "fall", "falls", "hit", "hits",
  "reach", "rise", "rises", "pump", "pumps", "break", "breaks", "limit", "resting",
  "buy", "sell", "ape", "grab", "cop", "dump", "put", "close", "exit", "cut", "bail",
  "half", "third", "quarter", "all", "everything", "rest", "tokens", "coins",
  "dollars", "bucks", "usd", "worth",
  "stop", "target", "trail", "trailing", "profit", "loss",
  "at", "of", "into", "with", "for", "then", "and",
];

export interface Collision {
  ticker: string;
  sentence: string;
  got: string;
  control: string;
}

/**
 * What a sentence became, reduced to the parts a NAME could plausibly change.
 *
 * Not the whole spec: ids are random and prices differ per token, and a
 * difference in either says nothing about the name.
 */
function outcome(text: string, label: string): string {
  const i = compile(text, {
    symbol: label,
    label,
    interval: "1h",
    hasPosition: true,
    price: 1,
    heldQty: 1e9,
  }).intent;
  if (i.kind !== "order") return i.kind;
  const e = i.spec.entry;
  return [
    "order",
    e ? `${e.side}:${e.amount.kind}:${e.trigger?.kind ?? "now"}` : "noentry",
    `exits=${i.spec.exits.map((x) => x.trigger.kind).join("+") || "none"}`,
  ].join(" ");
}

/** Every sentence where this name parses differently from the control. */
export function collisionsFor(ticker: string): Collision[] {
  const name = ticker.toLowerCase().replace(/[^a-z0-9]/g, "");
  /* The grammar captures 2-15 letters and will not read anything else as a
     token, so a name outside that is out of scope rather than colliding. A
     mint-addressed token is resolved by address and never by name. */
  if (name.length < 2 || name.length > 15 || /^\d/.test(name)) return [];

  const out: Collision[] = [];
  for (const template of SHAPES) {
    const sentence = template.replace("{}", name);
    const got = outcome(sentence, ticker);
    const control = outcome(template.replace("{}", CONTROL), ticker);
    if (got !== control) out.push({ ticker, sentence, got, control });
  }
  return out;
}

export function collisions(tickers: string[]): Collision[] {
  return tickers.flatMap(collisionsFor);
}
