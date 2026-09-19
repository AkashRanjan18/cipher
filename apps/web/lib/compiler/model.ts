import {
  INTENT_VERSION,
  type Compiled,
  type CompileContext,
  type Intent,
} from "@cipher/shared";
import { compiledSchema } from "./schema.ts";

/**
 * Ask the model, from the browser.
 *
 * Thin on purpose — every decision that matters is on the server. This exists
 * to turn an HTTP failure into a sentence, because the alternative is a
 * component that has to know what a 429 is.
 *
 * IT IS ONLY EVER CALLED AFTER THE GRAMMAR GIVES UP. That ordering is the cost
 * control: if the grammar covers most of what people type, this is a rounding
 * error on the bill; if it is tried first, every sentence is a paid request.
 * `Compiled.source` records which path answered so the ratio can be measured
 * rather than assumed.
 */

/**
 * The model could not be asked, or did not answer usably.
 *
 * Marked rather than thrown, because the caller has a better answer than any
 * of these sentences: the grammar's own reading. See choose.ts.
 */
export type ModelAnswer = Compiled & { unavailable?: true };

function refusal(reason: "outOfScope" | "notUnderstood" | "notBuilt", message: string): ModelAnswer {
  return {
    version: INTENT_VERSION,
    intent: { kind: "refusal", reason, message },
    source: "model",
    warnings: [],
    unavailable: true,
  };
}

export async function compileWithModel(
  text: string,
  ctx: CompileContext,
  signal?: AbortSignal,
): Promise<ModelAnswer> {
  let res: Response;
  try {
    res = await fetch("/api/compile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        symbol: ctx.symbol,
        label: ctx.label,
        price: ctx.price,
        heldQty: ctx.heldQty,
        interval: ctx.interval,
        hasPosition: ctx.hasPosition,
      }),
      signal,
    });
  } catch {
    // Offline, or the user typed something else and aborted this one.
    return refusal("notUnderstood", "I couldn't reach the parser. Try rephrasing it.");
  }

  /*
   * Each status gets its own sentence.
   *
   * "Something went wrong" is the message that teaches nothing and is the
   * reason a user gives up. Not signed in, out of allowance, and not
   * connected are three different problems with three different fixes, and
   * the person reading this can act on all three.
   */
  if (res.status === 401) {
    return refusal("notBuilt", "Sign in and I can work out the trickier sentences for you.");
  }
  if (res.status === 429) {
    return refusal("notBuilt", "That's a lot of sentences in a minute. Give it a moment.");
  }
  if (res.status === 503) {
    return refusal(
      "notBuilt",
      "I only understand the plainer phrasings right now. Try naming the amount and the token — “buy $250 of SOL”.",
    );
  }
  if (!res.ok) {
    return refusal("notUnderstood", "I couldn't work that one out. Try saying it more directly.");
  }

  /*
   * Validated a THIRD time, in the browser.
   *
   * The API validates on the way out, the route validates on the way in, and
   * this validates what crossed the network. That is not paranoia about the
   * model — it is that this object is one approval away from a trade, and
   * every hop it survives unchecked is a hop where it could have been changed.
   */
  const parsed = compiledSchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) {
    return refusal("notUnderstood", "I couldn't work that one out. Try saying it more directly.");
  }

  return {
    version: INTENT_VERSION,
    intent: parsed.data.intent as Intent,
    source: "model",
    warnings: parsed.data.warnings,
  };
}
