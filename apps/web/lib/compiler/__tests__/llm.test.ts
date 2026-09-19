import { test } from "node:test";
import assert from "node:assert/strict";
import { askModels, extractJson, providers, type Provider } from "../llm.ts";

const A: Provider = { name: "a", url: "https://a.test", key: "k", model: "m" };
const B: Provider = { name: "b", url: "https://b.test", key: "k", model: "m" };

const refusal = {
  intent: { kind: "refusal", reason: "outOfScope", message: "Not a trade." },
  warnings: [],
};

function reply(content: string, status = 200): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status });
}

test("no keys means unconfigured, and the grammar runs alone", async () => {
  assert.deepEqual(providers({}), []);
  assert.deepEqual(await askModels("s", "u", { list: [] }), { ok: false, reason: "unconfigured" });
});

test("a provider that fails is skipped and the next one answers", async () => {
  const seen: string[] = [];
  const fake = (async (url: string) => {
    seen.push(url);
    return url === A.url ? reply("", 429) : reply(JSON.stringify(refusal));
  }) as unknown as typeof fetch;

  const out = await askModels("s", "u", { list: [A, B], fetchImpl: fake });
  assert.equal(out.ok, true);
  if (out.ok) assert.equal(out.provider, "b");
  assert.deepEqual(seen, [A.url, B.url]);
});

test("an answer outside the schema is never accepted", async () => {
  const fake = (async () =>
    reply(JSON.stringify({ intent: { kind: "trade_everything" } }))) as unknown as typeof fetch;
  assert.deepEqual(await askModels("s", "u", { list: [A], fetchImpl: fake }), {
    ok: false,
    reason: "failed",
  });
});

test("JSON wrapped in fences or chatter is still found", () => {
  assert.deepEqual(extractJson('Sure!\n```json\n{"a":1}\n```'), { a: 1 });
  assert.equal(extractJson("no json here"), null);
});

/* ─────────────── orders only: the user's rule, 19 Sep 2026 ─────────────── */

import { ordersOnly, ORDERS_ONLY } from "../llm.ts";
import type { ModelCompiled } from "../schema.ts";

const refused = (c: ModelCompiled) =>
  c.intent.kind === "refusal" && c.intent.message === ORDERS_ONLY;

test("a question the model answered is replaced with the fixed refusal", () => {
  const out = ordersOnly({
    intent: { kind: "query", subject: "pnl" },
    warnings: ["You are up $40 today!"],
  } as ModelCompiled);
  assert.ok(refused(out));
  assert.deepEqual(out.warnings, []);
});

test("the model's own wording of a refusal never reaches the screen", () => {
  const out = ordersOnly({
    intent: { kind: "refusal", reason: "outOfScope", message: "BONK looks strong, but I can't advise." },
    warnings: [],
  } as ModelCompiled);
  assert.ok(refused(out));
});

test("a clarify survives only when every option is an order", () => {
  const size = ordersOnly({
    intent: {
      kind: "clarify",
      question: "Do you mean $100 of SOL, or 100 SOL?",
      options: [
        { label: "$100", sentence: "buy $100 of sol" },
        { label: "100 SOL", sentence: "buy 100 tokens of sol" },
      ],
    },
    warnings: [],
  } as ModelCompiled);
  assert.equal(size.intent.kind, "clarify");

  const chat = ordersOnly({
    intent: {
      kind: "clarify",
      question: "Want the news or the chart?",
      options: [
        { label: "News", sentence: "tell me the news" },
        { label: "Chart", sentence: "show me the chart" },
      ],
    },
    warnings: [],
  } as ModelCompiled);
  assert.ok(refused(chat));
});
