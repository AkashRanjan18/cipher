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
