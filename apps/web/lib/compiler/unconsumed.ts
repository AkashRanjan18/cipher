import type { OrderSpec } from "@cipher/shared";

/**
 * Words that asked for something the spec does not contain.
 *
 * THE RULE THIS ENFORCES IS ALREADY WRITTEN DOWN, in grammar.ts, above
 * `parseMultiple`: *"The grammar parses. validate.ts judges. Swallowing an
 * instruction is the one thing neither of them is allowed to do."* Nothing
 * enforced it, and the grammar broke it in five separate places at once — a
 * priority fee that armed at ordinary speed, a Jito tip that vanished, a
 * ladder that kept its first rung and dropped the second, "5x leverage" that
 * became a spot buy, "short" that became a token called short.
 *
 * Each of those was found by typing a sentence and reading the output. That
 * does not scale and it does not survive the next feature, because the failure
 * is SILENT: the parse succeeds, the readback is internally consistent, and
 * the only evidence that anything went wrong is a word in the original
 * sentence that nothing acted on.
 *
 * So this checks the sentence against the spec rather than the parser against
 * itself. If the user wrote a word that names a capability, the spec has to
 * show that capability set. When it does not, the readback says so — out
 * loud, on the card, before anything is approved.
 *
 * IT WARNS, IT DOES NOT REFUSE. Per CLAUDE.md the three outcomes are fixed:
 * an ERROR refuses, a WARNING proceeds and says so, an AMBIGUITY asks. A
 * dropped modifier is a warning — "buy $500 of bonk with a 0.001 SOL tip"
 * with the tip lost is still a buy the user wants, and refusing it entirely
 * would be worse than telling them the tip did not take.
 */

interface Check {
  /** Present in the sentence. */
  asked: RegExp;
  /** True when the spec actually carries it. */
  honoured: (s: OrderSpec) => boolean;
  /** What the readback says. Written to be read by someone mid-trade. */
  say: string;
}

const CHECKS: Check[] = [
  {
    asked: /\b(tip|tipping)\b/,
    honoured: (s) => s.entry?.tipSol != null,
    say: "I didn't catch the tip size — this arms with the default tip.",
  },
  {
    asked: /\b(priority|turbo|urgent)\b/,
    honoured: (s) => (s.entry?.priority ?? "normal") !== "normal",
    say: "I didn't catch the priority — this arms at normal speed.",
  },
  {
    asked: /\bslippage\b/,
    honoured: (s) => s.entry != null && s.entry.slippageBps !== 300,
    say: "I didn't catch the slippage — this arms at the default 3%.",
  },
  {
    asked: /\b(private|public)\s+(?:submission|mempool)\b/,
    honoured: (s) => s.entry != null,
    say: "I didn't catch how you wanted it submitted — this goes private.",
  },
  {
    /*
     * A LADDER LOSING A RUNG. Counting the `Nx` and `at $N` phrases against
     * the exits is the only way to notice: two rungs and one exit looks
     * perfectly normal from inside the spec.
     */
    asked: /\d\s*x\b/,
    honoured: (s) => {
      const rungs = s.exits.filter((e) => e.trigger.kind === "priceMultiple").length;
      return rungs > 0;
    },
    say: "I read a multiple but armed no take-profit at it.",
  },
  {
    asked: /\b(stop|stop-?loss)\b/,
    honoured: (s) =>
      s.exits.some(
        (e) => e.trigger.kind === "drawdownFromEntry" || e.trigger.kind === "trailingStop",
      ),
    say: "You asked for a stop and I didn't arm one — say the level, like \"stop at -20%\".",
  },
  {
    asked: /\btrail(?:ing)?\b/,
    honoured: (s) => s.exits.some((e) => e.trigger.kind === "trailingStop"),
    say: "You asked for a trailing stop and I didn't arm one — say how far, like \"trail 30%\".",
  },
];

/**
 * Count how many take-profit multiples the sentence names, so a two-rung
 * ladder that armed one rung is caught as well as one that armed none.
 */
function multiplesIn(text: string): number {
  return [...text.matchAll(/(\d[\d.]*)\s*x\b/g)].length;
}

export function unconsumed(text: string, spec: OrderSpec): string[] {
  const out: string[] = [];
  const t = text.toLowerCase();

  for (const c of CHECKS) {
    if (c.asked.test(t) && !c.honoured(spec)) out.push(c.say);
  }

  /* "A trailing stop" is one instruction, not two. Both checks fire on it and
     the specific message is the useful one, so the generic stop line goes. */
  if (/\btrail(?:ing)?\b/.test(t) && out.length > 1) {
    const generic = out.findIndex((w) => w.startsWith("You asked for a stop"));
    if (generic >= 0) out.splice(generic, 1);
  }

  /*
   * The rung count, separately, because "armed at least one" is not the same
   * claim as "armed all of them" and only the second is what the user asked
   * for. "Sell 25% at 2x and 25% at 5x" armed the 2x and dropped the 5x
   * without a word; from inside the spec that is a perfectly ordinary
   * one-step ladder.
   */
  const named = multiplesIn(t);
  const armed = spec.exits.filter((e) => e.trigger.kind === "priceMultiple").length;
  if (named > armed && armed > 0) {
    out.push(
      `You named ${named} take-profit levels and I armed ${armed}. Say them separately if that's wrong.`,
    );
  }

  return out;
}

/**
 * EVERY NUMBER THE PERSON SAID MUST BE IN THE ORDER. The gate before any
 * order executes, whichever reader produced it.
 *
 * Found live, 19 Sep 2026, reading with the model first: asked twice for the
 * same sentence, Groq once returned the buy with its stop and target, and
 * once returned the buy alone. It also turned "sell 30% of my sol at $95"
 * into a sell at market — dropping the one number that made it wait. A
 * dropped clause is a different trade, and it is invisible in the order
 * itself. It is not invisible against the sentence: every number said has
 * to land somewhere, as an amount, a price, a percentage or a multiple.
 *
 * `text` is the sentence AFTER normaliseSpeech, so "one twenty dollars" is
 * already "$120" and "negative ten percent" is "-10%".
 */
export function unplacedNumbers(text: string, spec: OrderSpec): string[] {
  const placed: number[] = [];
  const e = spec.entry;
  if (e) {
    placed.push(e.amount.value, e.slippageBps / 100);
    if (e.tipSol != null) placed.push(e.tipSol);
    if (e.trigger && "value" in e.trigger) placed.push(e.trigger.value);
  }
  for (const x of spec.exits) {
    placed.push(x.amount.value);
    const t = x.trigger as { value?: number; percent?: number; seconds?: number };
    for (const v of [t.value, t.percent]) if (typeof v === "number") placed.push(v);
    if (typeof t.seconds === "number") placed.push(t.seconds / 60, t.seconds / 3600, t.seconds / 86400);
  }
  const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.01, Math.abs(b) * 0.005);

  const out: string[] = [];
  for (const m of text.matchAll(/(\$)?\s*(\d[\d,]*(?:\.\d+)?)\s*([km])?\s*(%|x\b)?/g)) {
    let n = Number(m[2].replace(/,/g, ""));
    if (!Number.isFinite(n) || n === 0) continue;
    if (m[3] === "k") n *= 1_000;
    if (m[3] === "m") n *= 1_000_000;
    if (!placed.some((p) => close(p, n))) out.push(`${m[1] ?? ""}${m[2]}${m[3] ?? ""}${m[4] ?? ""}`);
  }
  return out;
}
