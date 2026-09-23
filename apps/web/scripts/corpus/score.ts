/**
 * Score the corpus: what did the compiler do with each sentence, and was it right?
 *
 *   node --experimental-strip-types scripts/corpus/score.ts
 *   node --env-file=.env.local --experimental-strip-types scripts/corpus/score.ts --model --limit 500
 *
 * THE OUTPUT IS FOUR BUCKETS, NOT ONE PERCENTAGE, and that is the whole design:
 *
 *     CORRECT   the spec matches what was said
 *     ASKED     came back a clarify        — safe. Costs one turn.
 *     REFUSED   came back a refusal        — safe. Costs a retype.
 *     WRONG     armed something different  — THIS IS THE ONE THAT COSTS MONEY
 *
 * A refusal and a wrong fill are both "not correct" and they are not remotely
 * the same event. Averaging them into one accuracy figure hides the only
 * failure that can sell somebody's position at a price they never said, so
 * WRONG is reported on its own line and any non-zero value is a release
 * blocker. Everything else is friction, and friction is a backlog item.
 *
 * Per-slot and per-tag, because "94%" tells you nothing you can act on and
 * "size:usd-spoken is 71%" tells you exactly where to go.
 *
 * The grammar pass needs no network and no key: it scores every row in
 * seconds, for free. --model adds the real model call and is rate-limited, so
 * it runs over a sample (see --limit).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Amount, Compiled, Interval, OrderSpec, Trigger } from "@cipher/shared";
import { compile } from "../../lib/compiler/compile.ts";
import { askModels } from "../../lib/compiler/llm.ts";
import { SYSTEM, userTurn } from "../../lib/compiler/prompt.ts";
import { choose, needsModel } from "../../lib/compiler/choose.ts";
import { resolveMarket } from "../../lib/market/markets.ts";
import type { Expected, Row } from "./generate.ts";

/* ───────────────────────────── the comparisons ─────────────────────────── */

/**
 * Prices are floats and the corpus rounds to four significant figures, so
 * exact equality would fail on arithmetic that is actually correct. Relative,
 * because 0.004 and 150000 are both real prices here and one absolute epsilon
 * cannot serve both.
 */
function sameNumber(a: number, b: number): boolean {
  if (a === b) return true;
  const scale = Math.max(Math.abs(a), Math.abs(b), 1e-9);
  return Math.abs(a - b) / scale < 1e-6;
}

function sameAmount(a: Amount | undefined, b: Amount | undefined): boolean {
  if (!a || !b) return a === b;
  return a.kind === b.kind && sameNumber(a.value, b.value);
}

function sameTrigger(a: Trigger | null | undefined, b: Trigger | null | undefined): boolean {
  if (a == null || b == null) return a == null && b == null;
  if (a.kind !== b.kind) return false;
  /* Each variant carries its number under a different key. Reading whichever
     one is present beats a switch that has to be edited every time the union
     grows a member. */
  const num = (t: Trigger): number =>
    "value" in t ? t.value : "percent" in t ? t.percent : "seconds" in t ? t.seconds : NaN;
  if (a.kind === "timeAbsolute" && b.kind === "timeAbsolute") return a.iso === b.iso;
  return sameNumber(num(a), num(b));
}

/**
 * The asset, not the spelling.
 *
 * "sol", "solana" and "solanas" are one asset said three ways, and a reader
 * that returns any of them got the slot right. An unresolvable word — every
 * memecoin, which is most of Solana — compares as itself, uppercased.
 */
function assetOf(token: string | undefined): string | null {
  if (!token) return null;
  return resolveMarket(token)?.base ?? token.toUpperCase();
}

/** The slots, scored one at a time so a failure names a dimension. */
const SLOTS = ["side", "asset", "amount", "entryTrigger", "exits"] as const;
type Slot = (typeof SLOTS)[number];

/**
 * Compare a produced spec against the expected answer, slot by slot.
 *
 * Returns null for a slot the row does not exercise — an exits-only sentence
 * has no entry side to get right, and counting it as a pass would inflate
 * every number on the board.
 */
function compareSlots(expect: Expected, got: OrderSpec): Record<Slot, boolean | null> {
  const e = expect.entry;
  const g = got.entry;

  const out: Record<Slot, boolean | null> = {
    side: null, asset: null, amount: null, entryTrigger: null, exits: null,
  };

  if (e === null) {
    /* An entry that should not exist is itself a slot: inventing a buy on a
       sentence that only asked to sell is the worst read available here. */
    out.side = g === null;
    out.asset = g === null;
    out.amount = g === null;
    out.entryTrigger = g === null;
  } else if (g === null) {
    out.side = false; out.asset = false; out.amount = false; out.entryTrigger = false;
  } else {
    out.side = e.side === g.side;
    out.asset = assetOf(e.asset) === assetOf(g.token);
    out.amount = sameAmount(e.amount, g.amount);
    out.entryTrigger = sameTrigger(e.trigger, g.trigger);
  }

  /* Exits compare as a SET. "stop at 180 and target 300" and "target 300 and
     stop at 180" are the same order, and a reader that returns them in the
     other order has not made a mistake. */
  const want = [...expect.exits];
  const have = [...got.exits];
  if (want.length !== have.length) {
    out.exits = false;
  } else {
    const unmatched = [...have];
    out.exits = want.every((w) => {
      const i = unmatched.findIndex(
        (h) => sameTrigger(w.trigger, h.trigger) && sameAmount(w.amount, h.amount),
      );
      if (i === -1) return false;
      unmatched.splice(i, 1);
      return true;
    });
  }

  return out;
}

/* ──────────────────────────────── the run ──────────────────────────────── */

type Verdict = "CORRECT" | "ASKED" | "REFUSED" | "WRONG";

interface Result {
  row: Row;
  verdict: Verdict;
  slots: Record<Slot, boolean | null>;
  ms: number;
  reader: string;
}

function verdictOf(c: Compiled, expect: Expected): { verdict: Verdict; slots: Record<Slot, boolean | null> } {
  const empty: Record<Slot, boolean | null> = {
    side: null, asset: null, amount: null, entryTrigger: null, exits: null,
  };
  const i = c.intent;
  if (i.kind === "clarify") return { verdict: "ASKED", slots: empty };
  if (i.kind === "refusal") return { verdict: "REFUSED", slots: empty };
  if (i.kind !== "order") {
    /* navigate / query / screen / ui on a sentence that was an order. It does
       not trade, but it is a misread, and hiding it under REFUSED would make
       a routing bug invisible. */
    return { verdict: "WRONG", slots: empty };
  }
  const slots = compareSlots(expect, i.spec);
  const every = SLOTS.every((s) => slots[s] !== false);
  return { verdict: every ? "CORRECT" : "WRONG", slots };
}

const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(f);
const num = (f: string, d: number) => {
  const i = argv.indexOf(f);
  return i === -1 ? d : Number(argv[i + 1]) || d;
};

const useModel = has("--model");
const limit = num("--limit", useModel ? 500 : Infinity);
const pace = num("--pace", useModel ? 22_000 : 0);
const file = has("--hard") ? "hard.jsonl" : "corpus.jsonl";

const path = resolve(import.meta.dirname, file);
const rows: Row[] = readFileSync(path, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l) as Row)
  .slice(0, limit === Infinity ? undefined : limit);

console.log(`scoring ${rows.length} rows from ${file}${useModel ? " (grammar + model)" : " (grammar only)"}\n`);

const results: Result[] = [];

for (const row of rows) {
  const ctx = {
    symbol: row.ctx.label,
    label: row.ctx.label,
    interval: "1h" as Interval,
    hasPosition: true,
    price: row.ctx.price,
    /* Generous on purpose: this measures READING, not whether the account can
       afford it. A refusal for insufficient balance is validate.ts doing its
       job and would mask a parse that was perfectly correct. */
    heldQty: 1e9,
  };

  const started = performance.now();
  const grammar = compile(row.text, ctx);
  let final = grammar;
  let reader = "grammar";

  if (useModel && needsModel(grammar)) {
    const out = await askModels(SYSTEM, userTurn(row.text, ctx));
    /*
     * Cast, as edge-battery.ts does. The zod schema in schema.ts is kept in
     * step with packages/shared/intent.ts BY HAND — shared carries no zod
     * dependency on purpose — so the two Intent types are structurally equal
     * without TypeScript being able to prove it.
     */
    const model: Compiled | null = out.ok
      ? ({ version: grammar.version, intent: out.compiled.intent, source: "model", warnings: [] } as Compiled)
      : null;
    final = choose(grammar, model, row.text);
    reader = out.ok
      ? final === grammar
        ? "grammar(model-refused)"
        : "model"
      : `grammar(${out.reason})`;
  }
  const ms = performance.now() - started;

  const { verdict, slots } = verdictOf(final, row.expect);
  results.push({ row, verdict, slots, ms, reader });

  if (pace && useModel && needsModel(grammar)) await new Promise((r) => setTimeout(r, pace));
}

/* ─────────────────────────────── the report ────────────────────────────── */

const pct = (n: number, d: number) => (d === 0 ? "  —  " : `${((n / d) * 100).toFixed(1)}%`.padStart(6));

const tally = new Map<Verdict, number>();
for (const r of results) tally.set(r.verdict, (tally.get(r.verdict) ?? 0) + 1);
const n = results.length;

console.log("── verdicts ──────────────────────────────");
for (const v of ["CORRECT", "ASKED", "REFUSED", "WRONG"] as Verdict[]) {
  const c = tally.get(v) ?? 0;
  console.log(`  ${v.padEnd(9)} ${String(c).padStart(6)}  ${pct(c, n)}`);
}

const wrong = tally.get("WRONG") ?? 0;
console.log(
  wrong === 0
    ? "\n  SAFETY: 0 wrong executions.\n"
    : `\n  SAFETY FAILURE: ${wrong} sentences would have armed the wrong order.\n`,
);

console.log("── slots ─────────────────────────────────");
for (const s of SLOTS) {
  const scored = results.filter((r) => r.slots[s] !== null);
  const right = scored.filter((r) => r.slots[s] === true).length;
  console.log(`  ${s.padEnd(13)} ${pct(right, scored.length)}  (${right}/${scored.length})`);
}

/** Every tag dimension, worst first — where to go next. */
console.log("\n── weakest dimensions ────────────────────");
const byTag = new Map<string, { ok: number; all: number }>();
for (const r of results) {
  for (const [k, v] of Object.entries(r.row.tags)) {
    if (!v || v === "-") continue;
    const key = `${k}:${v}`;
    const e = byTag.get(key) ?? { ok: 0, all: 0 };
    e.all += 1;
    if (r.verdict === "CORRECT") e.ok += 1;
    byTag.set(key, e);
  }
}
[...byTag]
  .filter(([, e]) => e.all >= 5)
  .sort((a, b) => a[1].ok / a[1].all - b[1].ok / b[1].all)
  .slice(0, 15)
  .forEach(([k, e]) => console.log(`  ${k.padEnd(28)} ${pct(e.ok, e.all)}  (${e.ok}/${e.all})`));

if (useModel) {
  const ms = results.map((r) => r.ms).sort((a, b) => a - b);
  const at = (q: number) => ms[Math.min(ms.length - 1, Math.floor(ms.length * q))];
  console.log("\n── latency ───────────────────────────────");
  console.log(`  p50 ${at(0.5).toFixed(0)}ms   p95 ${at(0.95).toFixed(0)}ms   max ${at(1).toFixed(0)}ms`);
}

/* The first few failures, in full, because a number tells you there is a
   problem and only the sentence tells you what it is. */
const failures = results.filter((r) => r.verdict === "WRONG");
if (failures.length) {
  console.log("\n── first wrong reads ─────────────────────");
  for (const f of failures.slice(0, 12)) {
    const bad = SLOTS.filter((s) => f.slots[s] === false).join(", ") || "not an order";
    console.log(`  » ${f.row.text}\n      missed: ${bad}   [${f.reader}]`);
  }
}
