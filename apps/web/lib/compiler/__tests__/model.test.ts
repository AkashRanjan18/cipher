import { test } from "node:test";
import assert from "node:assert/strict";
import { compileWithModel } from "../model.ts";
import { compiledSchema, intentSchema } from "../schema.ts";
import type { CompileContext } from "@cipher/shared";

const CTX: CompileContext = { symbol: "SOLUSDT", interval: "1h", hasPosition: false };

/** Stand in for fetch, restoring whatever was there. */
async function withFetch<T>(
  impl: (input: unknown, init?: unknown) => Promise<Response>,
  run: () => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  (globalThis as { fetch: unknown }).fetch = impl;
  try {
    return await run();
  } finally {
    (globalThis as { fetch: unknown }).fetch = original;
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/* ───────────────────── every failure is a sentence ─────────────────────── */

test("every failure path produces an intent, never a throw", async () => {
  const statuses = [400, 401, 429, 500, 502, 503];
  for (const status of statuses) {
    const out = await withFetch(
      async () => json({ error: "no" }, status),
      () => compileWithModel("dump my bags", CTX),
    );
    assert.equal(out.intent.kind, "refusal", `status ${status}`);
    assert.ok(
      out.intent.kind === "refusal" && out.intent.message.length > 0,
      `status ${status} said nothing`,
    );
  }
});

test("each status says something the user can act on", async () => {
  const message = async (status: number) => {
    const out = await withFetch(
      async () => json({ error: "no" }, status),
      () => compileWithModel("x", CTX),
    );
    return out.intent.kind === "refusal" ? out.intent.message : "";
  };

  // Three different problems, three different fixes. "Something went wrong"
  // is the message that teaches nothing.
  assert.match(await message(401), /[Ss]ign in/);
  assert.match(await message(429), /moment/);
  assert.match(await message(503), /buy \$250 of SOL/);
  assert.notEqual(await message(401), await message(429));
});

test("a network failure is a refusal, not an exception", async () => {
  const out = await withFetch(
    async () => {
      throw new TypeError("Failed to fetch");
    },
    () => compileWithModel("anything", CTX),
  );
  assert.equal(out.intent.kind, "refusal");
});

test("garbage that survives the network is still rejected", async () => {
  /*
   * The API validates on the way out and the route validates on the way in.
   * This is the third check, and it is not redundant: the object is one
   * approval away from a trade, and every unchecked hop is a hop where it
   * could have been changed.
   */
  for (const body of [
    null,
    { intent: { kind: "order" } }, // no spec
    { intent: { kind: "buy_everything" } }, // not in the union
    { intent: { kind: "order", spec: { version: 1, entry: null, exits: [] } } }, // no source
  ]) {
    const out = await withFetch(
      async () => json(body),
      () => compileWithModel("x", CTX),
    );
    assert.equal(out.intent.kind, "refusal", JSON.stringify(body));
  }
});

test("a good answer comes back marked as the model's", async () => {
  const out = await withFetch(
    async () =>
      json({
        intent: { kind: "query", subject: "pnl" },
        warnings: [],
      }),
    () => compileWithModel("am i up or down", CTX),
  );
  assert.equal(out.intent.kind, "query");
  // Measured, not assumed: if the grammar covers most traffic the model is a
  // rounding error on the bill, and you cannot know which without counting.
  assert.equal(out.source, "model");
});

/* ──────────────────────────── the schema itself ────────────────────────── */

test("the schema refuses the shapes that would be dangerous", () => {
  // A negative size.
  assert.equal(
    intentSchema.safeParse({
      kind: "order",
      spec: {
        version: 1,
        entry: {
          side: "buy",
          token: "sol",
          mint: null,
          amount: { kind: "usd", value: -500 },
          slippageBps: 300,
          privateSubmission: true,
        },
        exits: [],
        source: "model",
        warnings: [],
      },
    }).success,
    false,
  );

  // 50000 bps is 500% slippage. It was a real value once; a bound the model
  // can see beats a rejection it cannot.
  assert.equal(
    intentSchema.safeParse({
      kind: "order",
      spec: {
        version: 1,
        entry: {
          side: "buy",
          token: "sol",
          mint: null,
          amount: { kind: "usd", value: 500 },
          slippageBps: 50_000,
          privateSubmission: true,
        },
        exits: [],
        source: "model",
        warnings: [],
      },
    }).success,
    false,
  );

  // More than the whole position.
  assert.equal(
    intentSchema.safeParse({
      kind: "screen",
      metric: "return",
      direction: "top",
      limit: 999,
    }).success,
    false,
  );
});

test("a clarify must actually offer a choice", () => {
  assert.equal(
    intentSchema.safeParse({
      kind: "clarify",
      question: "Which one?",
      options: [{ label: "only one", sentence: "buy $1 of sol" }],
    }).success,
    false,
  );
});

test("warnings default to empty rather than undefined", () => {
  const parsed = compiledSchema.safeParse({ intent: { kind: "rules", action: "list" } });
  assert.ok(parsed.success);
  assert.deepEqual(parsed.data.warnings, []);
});
