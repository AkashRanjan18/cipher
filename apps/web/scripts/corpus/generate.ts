/**
 * The corpus: sentences, and the orders they are supposed to become.
 *
 *   node --experimental-strip-types scripts/corpus/generate.ts [--count 20000]
 *
 * THE WHOLE TRICK IS THAT THE LABEL COMES FIRST. A sentence is not written and
 * then annotated — a slot value like `{ kind: "usd", value: 500 }` is picked,
 * and "$500" / "five hundred dollars" / "500 bucks" are three ways of SAYING
 * that value. So every row arrives already knowing its own answer, and twenty
 * thousand of them cost nothing. Hand-labelling twenty thousand sentences
 * against a tagged union is a fortnight nobody would finish, which is why the
 * prompt bar has never had a number attached to it.
 *
 * WHAT IT IS NOT: a substitute for real sentences. Templates give breadth —
 * every combination of side, size, asset, entry and exits — and they cannot
 * give you "put ten bucks in and cut me if im wrong". Those live in hard.jsonl,
 * hand-written and scored as their own number. Averaging the two would hide the
 * one that is actually hard.
 *
 * Offline and deterministic: same seed, same corpus, so a score that moves
 * means the compiler changed and never that the dice did.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Amount, Trigger } from "@cipher/shared";

/* ─────────────────────────────── the shape ─────────────────────────────── */

/**
 * The answer, reduced to the things the user actually said.
 *
 * NOT an OrderSpec. A spec also carries `slippageBps`, `privateSubmission`,
 * `priority`, `tipSol`, exit `id`s and `source`, all filled from DEFAULTS when
 * the sentence is silent — scoring those would mark a perfect read wrong
 * because an id is a ulid. The knobs get their own templates later.
 *
 * `asset` is the RESOLVED ticker, never the word. "sol", "solana" and "solanas"
 * are one asset said three ways, and a reader that returns any of them got the
 * slot right; the spelling is `spellings()`' problem, not the compiler's.
 */
export interface Expected {
  entry: {
    side: "buy" | "sell";
    asset: string;
    amount: Amount;
    /** null means fill now. */
    trigger: Trigger | null;
  } | null;
  exits: { trigger: Trigger; amount: Amount }[];
}

export interface Row {
  text: string;
  expect: Expected;
  /**
   * The screen the sentence was said in front of.
   *
   * compile() takes a CompileContext and several matchers read it — the
   * ambiguity check asks whether a bare word names the coin currently open,
   * and validate.ts needs a price to judge a level against. Carrying it in the
   * row keeps corpus.jsonl a COMPLETE input: the scorer needs no table of
   * assets and no import from this file, so the two cannot drift apart.
   */
  ctx: { label: string; price: number };
  /**
   * Which slot value produced each part, so a failure names a DIMENSION rather
   * than a sentence. "size:usd-spoken fails 8% of the time" is something you
   * can go and fix; a list of forty failing sentences is something you read.
   */
  tags: Record<string, string>;
}

/** A way of saying a value: the words, and what they mean. */
interface Say<T> {
  say: string;
  val: T;
  tag: string;
}

/* ──────────────────────────── the vocabularies ─────────────────────────── */

/**
 * Assets, with a reference price each.
 *
 * Only SOL, BTC and ETH are hardcoded in MARKETS; every other token arrives
 * from Jupiter at runtime, which would make this file need a network. BONK is
 * here deliberately unresolvable — that is the ordinary case on Solana, and its
 * price is what exercises the decimal path that "point oh oh four" broke.
 */
const ASSETS = [
  { asset: "SOL", words: ["sol", "solana", "solanas"], price: 200 },
  { asset: "BTC", words: ["btc", "bitcoin"], price: 100_000 },
  { asset: "ETH", words: ["eth", "ethereum"], price: 4_000 },
  { asset: "BONK", words: ["bonk"], price: 0.004 },
];

/** Verbs that open a position, each with the preposition it takes. */
const OPENS = [
  { verb: (a: string, t: string) => `buy ${a} of ${t}`, tag: "buy-of" },
  { verb: (a: string, t: string) => `buy ${a} worth of ${t}`, tag: "buy-worth" },
  { verb: (a: string, t: string) => `ape ${a} into ${t}`, tag: "ape-into" },
  { verb: (a: string, t: string) => `grab ${a} of ${t}`, tag: "grab" },
  { verb: (a: string, t: string) => `get me ${a} of ${t}`, tag: "get-me" },
  { verb: (a: string, t: string) => `put ${a} into ${t}`, tag: "put-into" },
];

/** Only where a person would really say it aloud — nobody speaks 100,250. */
const SPOKEN_USD: Record<number, string> = {
  50: "fifty",
  100: "a hundred",
  250: "two fifty",
  500: "five hundred",
  1000: "a thousand",
};

/** Dollar sizes, in the forms people write and say them. */
function usdSays(v: number): Say<Amount>[] {
  const val: Amount = { kind: "usd", value: v };
  const out: Say<Amount>[] = [
    { say: `$${v}`, val, tag: "usd-symbol" },
    { say: `${v} dollars`, val, tag: "usd-word" },
    { say: `${v} bucks`, val, tag: "usd-slang" },
  ];
  if (SPOKEN_USD[v]) out.push({ say: `${SPOKEN_USD[v]} dollars`, val, tag: "usd-spoken" });
  return out;
}

/**
 * Token-denominated sizes.
 *
 * NAMES NO TOKEN. The verb template supplies it — "buy 5 tokens OF sol" — and
 * a size that carried its own produced "ape 5 tokens of eth into ethereum",
 * which is not a sentence anybody has ever said. A slot value has to compose
 * with every verb or it is not a slot value.
 *
 * The bare form ("buy 5 sol") is excluded on purpose: compile.ts detects it as
 * AMBIGUOUS and returns a clarify, which is correct behaviour and a different
 * expected answer. It belongs in the hard set with a clarify for its label,
 * not here where every row is an order.
 */
function tokenSays(v: number): Say<Amount>[] {
  const val: Amount = { kind: "tokens", value: v };
  return [{ say: `${v} tokens`, val, tag: "tok-explicit" }];
}

/**
 * Ways of saying "close some of what I hold, at this price".
 *
 * `sell` is the plain one; the rest are how it is actually said in a chat.
 * "take profit" is here because it is the phrase people reach for and it names
 * no side — the side comes from holding the token, not from the verb.
 */
const CLOSES: ((share: string, token: string, price: string) => string)[] = [
  (s, t, p) => `sell ${s} of my ${t} at ${p}`,
  (s, t, p) => `sell ${s} of my ${t} when it hits ${p}`,
  (s, t, p) => `take profit on ${s} of my ${t} at ${p}`,
  (s, t, p) => `dump ${s} of my ${t} at ${p}`,
  (s, t, p) => `get me out of ${s} of my ${t} at ${p}`,
];

/** Sizes that are a share of what is already held. */
const SHARES: Say<Amount>[] = [
  { say: "30%", val: { kind: "percentOfPosition", value: 30 }, tag: "pct-digits" },
  { say: "thirty percent", val: { kind: "percentOfPosition", value: 30 }, tag: "pct-spoken" },
  { say: "half", val: { kind: "percentOfPosition", value: 50 }, tag: "pct-half" },
  { say: "a third", val: { kind: "percentOfPosition", value: 33 }, tag: "pct-third" },
  /* "all", not "all of it": every CLOSES template continues "of my SOL", and
     "sell all of it of my solana" is not a sentence. A slot value has to
     compose with every template that uses it. */
  { say: "all", val: { kind: "percentOfPosition", value: 100 }, tag: "pct-all" },
];

const DIGIT_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

/**
 * A price as digits, and — below a dollar — as the words someone speaks.
 *
 * "0.0044" is said "point oh oh four four", digit by digit, and that form
 * returned 44 until 23 Sep 2026. Memecoins are the prices cipher trades, so
 * this is not an edge case; it is the main case wearing different clothes.
 */
function priceSays(p: number): Say<number>[] {
  const digits = p < 1 ? p.toFixed(4).replace(/0+$/, "") : String(p);
  const out: Say<number>[] = [{ say: digits, val: p, tag: "price-digits" }];
  if (p < 1) {
    const decimals = digits.split(".")[1] ?? "";
    const spoken = "point " + [...decimals].map((d) => DIGIT_WORDS[Number(d)]).join(" ");
    out.push({ say: spoken, val: p, tag: "price-spoken-decimal" });
  }
  return out;
}

/* ─────────────────────────────── the sampler ───────────────────────────── */

const SEED = 20260923;

/** mulberry32: small, seeded, and good enough to shuffle a list. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(SEED);

/* ─────────────────────────────── the shapes ────────────────────────────── */

/** Whole-position, the default when a sentence names an exit but not a size. */
const ALL: Amount = { kind: "percentOfPosition", value: 100 };
/**
 * "the rest" — what the other exits leave behind.
 *
 * grammar.ts parses it as a -1 sentinel and then `resolveRest()` turns it into
 * a real percentage BEFORE the spec leaves the parser, so the compiled order
 * never carries the sentinel. The corpus labelled it -1 and marked every
 * ladder wrong; the grammar was right and the label was not.
 */
const rest = (taken: number): Amount => ({ kind: "percentOfPosition", value: 100 - taken });

/** Every row the templates can produce, before sampling. */
function* rows(): Generator<Row> {
  for (const a of ASSETS) {
    const word = a.words[0];
    const stopAt = Number((a.price * 0.9).toPrecision(4));
    const targetAt = Number((a.price * 1.5).toPrecision(4));
    const entryAt = Number((a.price * 0.95).toPrecision(4));

    for (const open of OPENS) {
      const sizes = [...usdSays(500), ...usdSays(50), ...tokenSays(5)];
      for (const size of sizes) {
        for (const spelling of a.words) {
          const head = open.verb(size.say, spelling);
          const entry = { side: "buy" as const, asset: a.asset, amount: size.val, trigger: null };
          const tags = { shape: "", open: open.tag, size: size.tag, asset: a.asset, spelling };
          const ctx = { label: a.asset, price: a.price };

          /* 1. a market buy and nothing else */
          yield { text: head, expect: { entry, exits: [] }, ctx, tags: { ...tags, shape: "market" } };

          /* 2. a stop, absolute and as a drawdown from the fill */
          for (const p of priceSays(stopAt)) {
            yield {
              text: `${head} and stop at ${p.say}`,
              expect: { entry, exits: [{ trigger: { kind: "priceAbsolute", value: p.val }, amount: ALL }] },
              ctx,
              tags: { ...tags, shape: "stop-absolute", price: p.tag },
            };
          }
          yield {
            text: `${head} and set a stop loss of 10%`,
            expect: { entry, exits: [{ trigger: { kind: "drawdownFromEntry", percent: 10 }, amount: ALL }] },
            ctx,
            tags: { ...tags, shape: "stop-drawdown" },
          };

          /* 3. a target, absolute and as a multiple of the fill */
          for (const p of priceSays(targetAt)) {
            yield {
              text: `${head} and sell at ${p.say}`,
              expect: { entry, exits: [{ trigger: { kind: "priceAbsolute", value: p.val }, amount: ALL }] },
              ctx,
              tags: { ...tags, shape: "target-absolute", price: p.tag },
            };
          }
          yield {
            text: `${head} and take profit at 2x`,
            expect: { entry, exits: [{ trigger: { kind: "priceMultiple", value: 2 }, amount: ALL }] },
            ctx,
            tags: { ...tags, shape: "target-multiple" },
          };

          /* 4. the whole order in one sentence — what cipher exists for */
          yield {
            text: `${head}, stop at ${stopAt} and target ${targetAt}`,
            expect: {
              entry,
              exits: [
                { trigger: { kind: "priceAbsolute", value: stopAt }, amount: ALL },
                { trigger: { kind: "priceAbsolute", value: targetAt }, amount: ALL },
              ],
            },
            ctx,
            tags: { ...tags, shape: "entry-stop-target" },
          };

          /* 5. a resting entry. Always below the market: there is no buy stop. */
          yield {
            text: `${head} when it drops to ${entryAt}`,
            expect: { entry: { ...entry, trigger: { kind: "priceAbsolute", value: entryAt } }, exits: [] },
            ctx,
            tags: { ...tags, shape: "entry-limit" },
          };

          /* 6. a ladder: a share out at the target, the remainder stopped */
          for (const share of SHARES.slice(0, 3)) {
            yield {
              text: `${head}, sell ${share.say} at ${targetAt} and stop the rest at ${stopAt}`,
              expect: {
                entry,
                exits: [
                  { trigger: { kind: "priceAbsolute", value: targetAt }, amount: share.val },
                  { trigger: { kind: "priceAbsolute", value: stopAt }, amount: rest(share.val.value) },
                ],
              },
              ctx,
              tags: { ...tags, shape: "ladder", share: share.tag },
            };
          }

          /* 7. a trailing stop */
          yield {
            text: `${head} and trail it by 15%`,
            expect: { entry, exits: [{ trigger: { kind: "trailingStop", percent: 15 }, amount: ALL }] },
            ctx,
            tags: { ...tags, shape: "trailing" },
          };
        }
      }
    }

    /*
     * 8. exits alone, against a position already held.
     *
     * Carries its own verbs for the same reason entries do. Without them this
     * shape produced 25 rows against the ladder's 1,440, so the commonest
     * thing anyone types at a terminal they already hold a bag in was the
     * least tested thing in the corpus.
     */
    for (const share of SHARES) {
      for (const spelling of a.words) {
        for (const p of priceSays(targetAt)) {
          for (const close of CLOSES) {
            yield {
              text: close(share.say, spelling, p.say),
              /*
               * A RESTING SELL IS AN ENTRY WITH A TRIGGER, not an exit.
               * CLAUDE.md settles this: `Entry.trigger` is `Trigger | null`,
               * and a rule carries a `side` precisely so that a resting sell
               * and a resting buy are one machine. `exits` are the rules that
               * hang off an entry, and a sentence with no buy in it has none.
               */
              expect: {
                entry: { side: "sell", asset: a.asset, amount: share.val, trigger: { kind: "priceAbsolute", value: p.val } },
                exits: [],
              },
                  ctx: { label: a.asset, price: a.price },
              tags: { shape: "exit-only", open: "-", size: share.tag, asset: a.asset, spelling, price: p.tag },
            };
          }
        }
      }
    }
  }
}

/* ──────────────────────────────── the write ────────────────────────────── */

const flag = process.argv.indexOf("--count");
const count = flag === -1 ? 20_000 : Number(process.argv[flag + 1]) || 20_000;
const out = resolve(import.meta.dirname, "corpus.jsonl");

const all = [...rows()];
/* Fisher-Yates on the seeded rng, then take the head — a sample spread across
   every template, rather than the first N rows of the first asset. */
for (let i = all.length - 1; i > 0; i--) {
  const j = Math.floor(rand() * (i + 1));
  [all[i], all[j]] = [all[j], all[i]];
}
const sample = all.slice(0, count);

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, sample.map((r) => JSON.stringify(r)).join("\n") + "\n");

const byShape = new Map<string, number>();
for (const r of sample) byShape.set(r.tags.shape, (byShape.get(r.tags.shape) ?? 0) + 1);
console.log(`${all.length} rows possible, wrote ${sample.length} → ${out}`);
for (const [shape, n] of [...byShape].sort((x, y) => y[1] - x[1])) {
  console.log(`  ${shape.padEnd(20)} ${n}`);
}
