import { z } from "zod";
import { compiledSchema, intentSchema, type ModelCompiled } from "./schema.ts";

/**
 * THE MODEL FALLBACK: any open model, through any OpenAI-compatible provider.
 *
 * Called only after the grammar gives up (see lib/compiler/model.ts, and the
 * route in app/api/compile). Its whole job is to fill in the SAME closed
 * schema the grammar produces — it never trades, never executes, and anything
 * it returns that does not fit the schema is thrown away.
 *
 * WHY NOT ONE VENDOR'S SDK. Groq, OpenRouter, Together, Gemini's compat mode
 * and a local Ollama all speak the same `/chat/completions` shape. So the
 * providers are a LIST, tried in order: a free tier that is rate-limited or
 * down is skipped and the next one answers. Changing model is an environment
 * variable, not a code change.
 *
 *   GROQ_API_KEY           Groq — fast, free tier, open models
 *   GROQ_MODEL             default openai/gpt-oss-120b
 *   OPENROUTER_API_KEY     OpenRouter — the backup; free models end in :free
 *   OPENROUTER_MODEL       default qwen/qwen3.8-27b:free
 *
 * A provider with no key is skipped. With none at all the route answers 503
 * and cipher runs on the grammar alone, which is a smaller vocabulary rather
 * than a broken product.
 */

export interface Provider {
  name: string;
  url: string;
  key: string;
  model: string;
}

export function providers(env: Record<string, string | undefined> = process.env): Provider[] {
  const list: Provider[] = [];
  if (env.GROQ_API_KEY) {
    list.push({
      name: "groq",
      url: "https://api.groq.com/openai/v1/chat/completions",
      key: env.GROQ_API_KEY,
      model: env.GROQ_MODEL || "openai/gpt-oss-120b",
    });
  }
  if (env.OPENROUTER_API_KEY) {
    list.push({
      name: "openrouter",
      url: "https://openrouter.ai/api/v1/chat/completions",
      key: env.OPENROUTER_API_KEY,
      model: env.OPENROUTER_MODEL || "qwen/qwen3.8-27b:free",
    });
  }
  return list;
}

/*
 * The schema, written out for the model.
 *
 * Only a few providers enforce a JSON schema on the way out, and the free
 * tiers mostly do not. So the schema goes into the prompt, the provider is
 * asked for "a JSON object", and OUR side enforces the schema with zod. The
 * enforcement is the part that matters; the prompt only makes a pass likely.
 */
const SHAPE = JSON.stringify(
  z.toJSONSchema(
    /*
     * ONLY THE THREE KINDS THE MODEL MAY RETURN. The full schema also
     * describes queries, navigation and screens, which ordersOnly() throws
     * away anyway — and at ~2,400 tokens a request it spent Groq's free
     * 8,000-tokens-a-minute allowance in three sentences, for the whole app.
     */
    z.object({
      intent: z.discriminatedUnion(
        "kind",
        intentSchema.options.filter((o) =>
          ["order", "clarify", "refusal"].includes(o.shape.kind.value as string),
        ) as unknown as [typeof intentSchema.options[number], ...typeof intentSchema.options[number][]],
      ),
    }),
    { io: "input" },
  ),
);

/**
 * Pull the first JSON object out of a reply.
 *
 * Asked for bare JSON, small models still sometimes wrap it in ```json fences
 * or a sentence of preamble. Finding the outermost braces is enough; anything
 * that is not then valid JSON of the right shape is rejected downstream.
 */
export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** The only thing the model is ever allowed to say that is not an order. */
export const ORDERS_ONLY = "I only place orders — I can't help with that.";

/*
 * An order-shaped sentence: what a clarify option has to look like.
 */
const ORDERISH = /\b(buy|sell|stop|take profit|target|trail|close|exit|dump)\b/;

/**
 * ORDERS ONLY. The user's rule, 19 Sep 2026: the model places orders and
 * nothing else — any other request is refused, flatly, in cipher's words.
 *
 * Enforced HERE, on what came back, not by asking nicely in the prompt. The
 * model writes free text in three places — a refusal's message, a clarify's
 * question, and warnings — and each is a channel through which it could
 * answer a question, give an opinion, or chat. So:
 *
 *   order     passes, with its warnings dropped (the validator writes the
 *             warnings that matter, from the order itself)
 *   clarify   passes only when every option is itself an order sentence,
 *             which is the size question ("$100 or 100 SOL?") and nothing else
 *   anything  else — a query, navigation, a screen, a refusal the model
 *             worded — becomes ORDERS_ONLY, a sentence the model never wrote
 *
 * The grammar still answers "what's my P&L" and "show me BTC" itself; this
 * only governs what the MODEL may put on screen.
 */
export function ordersOnly(c: ModelCompiled): ModelCompiled {
  const i = c.intent;
  if (i.kind === "order") return { intent: i, warnings: [] };
  if (i.kind === "clarify") {
    const sentences = [...(i.options ?? []).map((o) => o.sentence), ...(i.fill ? [i.fill.template] : [])];
    if (sentences.length > 0 && sentences.every((x) => ORDERISH.test(x.toLowerCase()))) {
      return { intent: i, warnings: [] };
    }
  }
  return { intent: { kind: "refusal", reason: "outOfScope", message: ORDERS_ONLY }, warnings: [] };
}

export type Outcome =
  | { ok: true; compiled: ModelCompiled; provider: string }
  | { ok: false; reason: "unconfigured" | "failed" };

/**
 * Ask each provider in turn until one returns a shape we accept.
 *
 * A provider that errors, times out, or returns something off-schema is
 * logged and skipped — the NEXT provider may well be fine, and a wrong answer
 * from one model is not evidence about another.
 */
export async function askModels(
  system: string,
  user: string,
  opts: { list?: Provider[]; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<Outcome> {
  const list = opts.list ?? providers();
  if (list.length === 0) return { ok: false, reason: "unconfigured" };
  const doFetch = opts.fetchImpl ?? fetch;

  for (const p of list) {
    try {
      const res = await doFetch(p.url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${p.key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: p.model,
          /* Zero: this is transcription into a schema, and the same sentence
             should compile the same way every time. */
          temperature: 0,
          max_tokens: 800,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content: `${system}\n\nReply with ONE JSON object and nothing else. It must match this JSON Schema:\n${SHAPE}`,
            },
            { role: "user", content: user },
          ],
        }),
        /* A trader is waiting. Past this the grammar's refusal is already on
           screen and a late answer is worth less than the next provider. */
        signal: AbortSignal.timeout(opts.timeoutMs ?? 8_000),
      });
      if (!res.ok) {
        console.error(`[cipher] ${p.name} ${res.status}`, (await res.text().catch(() => "")).slice(0, 300));
        continue;
      }
      const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const raw = extractJson(body.choices?.[0]?.message?.content ?? "");
      const safe = compiledSchema.safeParse(raw);
      if (!safe.success) {
        console.error(`[cipher] ${p.name} returned a shape we do not accept:`, safe.error.issues.slice(0, 3));
        continue;
      }
      return { ok: true, compiled: ordersOnly(safe.data), provider: p.name };
    } catch (e) {
      console.error(`[cipher] ${p.name} unreachable:`, e);
    }
  }
  return { ok: false, reason: "failed" };
}
