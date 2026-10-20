import type { Compiled } from "@cipher/shared";
import type { Outcome } from "../db/prompts.ts";

/**
 * Send one sentence to the prompt log, from the browser.
 *
 * FIRE AND FORGET, AND IT CANNOT THROW. The caller is the prompt bar, one
 * line away from a trade; a logging call that rejected, or that the bar
 * awaited, would be a way for a dashboard to break an order.
 *
 * `keepalive` matters: a sentence that navigates away — "show me BTC", or a
 * refusal the user answers by closing the tab — would otherwise be cancelled
 * with the page, and those are exactly the sentences worth having.
 */
export function logPrompt(
  text: string,
  compiled: Compiled,
  outcome: Outcome,
  extra: { market?: string; ms?: number } = {},
): void {
  const intent = compiled.intent;
  try {
    void fetch("/api/prompts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        text,
        reader: compiled.source,
        kind: intent.kind,
        reason: intent.kind === "refusal" ? intent.reason : undefined,
        /* The spec, not the whole intent: it is the half that can be counted
           later ("how many orders carried a stop"), and the rest is UI. */
        spec: intent.kind === "order" ? intent.spec : undefined,
        outcome,
        market: extra.market,
        ms: extra.ms,
      }),
    }).catch(() => {});
  } catch {
    /* A browser that refuses the request at all — offline, a blocked origin —
       is not a reason for anything to surface. */
  }
}
