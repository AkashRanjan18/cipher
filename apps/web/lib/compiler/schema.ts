import { z } from "zod";

/**
 * The Intent union, as a schema.
 *
 * TWO JOBS, and the second is the one that matters.
 *
 * It is the model's output contract: handed to the API as a structured output
 * format, so the model fills a closed shape rather than writing prose we then
 * have to parse. A model TOLD to stay in scope eventually will not; a model
 * given a schema with no field for "search the web" cannot put one there.
 *
 * It is also the runtime guard on what comes back. The API validates against
 * this on the way out, and cipher validates again on the way in — because
 * "the provider says it conforms" is a claim about someone else's service, and
 * this is the boundary between a sentence and a trade. Nothing downstream ever
 * sees an object that has not been through here.
 *
 * It must stay in step with packages/shared/src/intent.ts by hand. That is a
 * real cost and it is worth it: shared has no zod dependency and should not
 * grow one just so a browser bundle can validate a network response.
 */

const amount = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("usd"), value: z.number().positive() }),
  z.object({ kind: z.literal("tokens"), value: z.number().positive() }),
  z.object({
    kind: z.literal("percentOfPosition"),
    value: z.number().positive().max(100),
  }),
]);

const trigger = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("priceMultiple"), value: z.number().positive() }),
  z.object({ kind: z.literal("priceAbsolute"), value: z.number().positive() }),
  z.object({
    kind: z.literal("drawdownFromEntry"),
    percent: z.number().positive().max(99),
  }),
  z.object({
    kind: z.literal("trailingStop"),
    percent: z.number().positive().max(99),
  }),
  z.object({ kind: z.literal("timeAbsolute"), iso: z.string() }),
  z.object({ kind: z.literal("duration"), seconds: z.number().positive() }),
]);

const exitRule = z.object({
  id: z.string(),
  trigger,
  amount,
});

const entry = z.object({
  side: z.enum(["buy", "sell"]),
  /** Whatever the user said. Resolved against the allowlist AFTER validation. */
  token: z.string().min(1).max(20),
  mint: z.string().nullable(),
  amount,
  /*
   * Bounded in the schema, not just checked later.
   *
   * 50000 bps is 500% and would have been a real value here — the validator
   * catches it, but a bound the model can see is better than a rejection it
   * cannot. 10000 bps is 100%: the whole trade.
   */
  slippageBps: z.number().int().min(1).max(10_000),
  privateSubmission: z.boolean(),
});

const orderSpec = z.object({
  version: z.literal(1),
  entry: entry.nullable(),
  exits: z.array(exitRule).max(10),
  source: z.enum(["grammar", "model"]),
  warnings: z.array(z.string()).max(10),
});

export const intentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("order"), spec: orderSpec }),
  z.object({
    kind: z.literal("navigate"),
    symbol: z.string().optional(),
    interval: z.enum(["1m", "5m", "15m", "1h", "4h", "1d"]).optional(),
    panel: z.enum(["alerts", "tokens", "leaders", "feed"]).optional(),
  }),
  z.object({
    kind: z.literal("query"),
    subject: z.enum(["position", "cash", "equity", "pnl", "fills", "market", "fees"]),
    symbol: z.string().optional(),
  }),
  z.object({
    kind: z.literal("screen"),
    metric: z.enum(["return", "volume", "marketCap", "price"]),
    direction: z.enum(["top", "bottom"]),
    limit: z.number().int().min(1).max(14),
  }),
  z.object({ kind: z.literal("rules"), action: z.enum(["list", "cancelAll"]) }),
  z.object({
    kind: z.literal("ui"),
    action: z.enum([
      "collapsePanel",
      "expandPanel",
      "splitBottom",
      "splitRight",
      "resetChart",
    ]),
  }),
  z.object({
    kind: z.literal("clarify"),
    question: z.string().min(1).max(200),
    options: z
      .array(z.object({ label: z.string().min(1).max(40), sentence: z.string().min(1).max(200) }))
      .min(2)
      .max(4),
  }),
  z.object({
    kind: z.literal("refusal"),
    reason: z.enum(["outOfScope", "notUnderstood", "notBuilt"]),
    message: z.string().min(1).max(300),
  }),
]);

export const compiledSchema = z.object({
  intent: intentSchema,
  /**
   * Understood but not actionable. Rides on the card; never hidden.
   *
   * Capped, because a model with an unbounded string array will eventually
   * write an essay into it and the readback becomes unreadable.
   */
  warnings: z.array(z.string().max(200)).max(5).default([]),
});

export type ModelCompiled = z.infer<typeof compiledSchema>;
