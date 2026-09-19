import type { Compiled } from "@cipher/shared";
import { unplacedNumbers } from "./unconsumed.ts";
import { normaliseSpeech } from "../voice/normalise.ts";

/**
 * The one sentence cipher says to anything that is not an order — from the
 * model or the grammar alike. The user's rule, 19 Sep 2026: deny it
 * straight away, in the same words every time.
 */
export const ORDERS_ONLY = "I only place orders — I can't help with that.";

/**
 * WHICH READER ANSWERS: the model first for orders, the grammar as the net.
 *
 * The user's call, 19 Sep 2026, for the MVP: the model parses every order
 * sentence, because it reads "one twenty", "stop loss of -10%" and "put ten
 * bucks in" the way people mean them, and the grammar does not. The model
 * still only fills in the order form — it never executes, and ordersOnly()
 * on the server throws away anything that is not an order.
 *
 * The grammar stays for three things:
 *   - what it answers without the model at all: account questions,
 *     navigation, layout, the rules list, and its own size question
 *     ("$6 or 6 SOL?") — deterministic, instant, and not orders
 *   - the fallback when the model is unreachable, rate-limited, or the user
 *     is signed out, so the bar never stops working
 *   - a clean order the model refused, which is a model mistake, not a
 *     boundary: "buy $50 of sol" is an order whichever reader says so
 */

/** Does this sentence go to the model? Only when it is, or might be, an order. */
export function needsModel(grammar: Compiled): boolean {
  const i = grammar.intent;
  if (i.kind === "order") return true;
  /* The grammar could not read it at all. A refusal for being out of scope
     is a decision, not a failure, and asking again would re-open it. */
  if (i.kind === "refusal") return i.reason === "notUnderstood";
  return false;
}

/**
 * Pick the answer once the model has spoken — or failed to.
 *
 * `model` is null when the model could not be asked or did not answer: no
 * key, not signed in, rate-limited, down, or off-schema.
 *
 * NO ORDER LEAVES HERE MISSING A NUMBER THE PERSON SAID (unplacedNumbers).
 * The model's order is preferred; if it dropped something, the grammar's is
 * used if IT is complete; if neither is, nothing executes and the person is
 * told which number could not be placed.
 */
export function choose(grammar: Compiled, model: Compiled | null, text = ""): Compiled {
  const said = normaliseSpeech(text);
  const complete = (c: Compiled | null) =>
    c !== null && c.intent.kind === "order" && unplacedNumbers(said, c.intent.spec).length === 0;

  /*
   * A QUESTION MUST NOT FORGET THE ORDER. Each answer is re-run as a whole
   * sentence, so every number the person said has to survive into every
   * option — or answering "$5 or 5 SOL?" silently drops the stop and target
   * that came with it (the user's rule, 19 Sep 2026). A model question that
   * loses one gives way to the grammar's reading.
   */
  if (model && model.intent.kind === "clarify") {
    const numbers = [...said.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => m[0].replace(/,/g, ""));
    const answers = [
      ...(model.intent.options ?? []).map((o) => o.sentence),
      ...(model.intent.fill ? [model.intent.fill.template] : []),
    ].map((s) => normaliseSpeech(s));
    const keepsAll = answers.every((a) => numbers.every((n) => a.includes(n)));
    if (keepsAll || grammar.intent.kind !== "order") return model;
  }
  if (complete(model)) return model!;
  if (complete(grammar) && grammar.warnings.length === 0) return grammar;

  /* Somebody read an order, and every reading lost part of it. */
  const reading = [model, grammar].find((c) => c?.intent.kind === "order");
  if (reading && reading.intent.kind === "order") {
    const lost = unplacedNumbers(said, reading.intent.spec);
    return {
      version: reading.version,
      intent: {
        kind: "refusal",
        reason: "notUnderstood",
        message: lost.length
          ? `I couldn't place ${lost.join(", ")} in that order, so I did nothing. Say it in two parts — the buy, then the stop or target.`
          : `I couldn't read all of that order, so I did nothing. ${grammar.warnings[0] ?? "Say it in two parts — the buy, then the stop or target."}`,
      },
      source: reading.source,
      warnings: [],
    };
  }

  /* No order anywhere: the model's refusal (the fixed sentence) or the
     grammar's own answer when the model could not be asked. */
  return model ?? grammar;
}
