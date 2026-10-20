import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { database, type Harness } from "./harness.ts";
import { record, stats, failures, MAX_TEXT } from "../prompts.ts";

/**
 * The prompt log, against a real Postgres.
 *
 * `jsonb_array_length(spec->'exits')` is the one query here that could fail
 * only on the real thing — an order with no exits, or a spec that never had
 * the key, has to count as zero rather than throw. That is the whole reason
 * these run against PGlite instead of a stub.
 */

let h: Harness;
before(async () => {
  h = await database();
});
after(async () => {
  await h.close();
});
beforeEach(async () => {
  await h.reset();
});

const entry = (over: Partial<Parameters<typeof record>[0]> = {}) => ({
  userId: "u1",
  at: Date.now(),
  text: "buy $100 of sol",
  reader: "grammar" as const,
  kind: "order",
  outcome: "executed" as const,
  ...over,
});

test("a sentence is written with its compiled spec", async () => {
  await record(entry({ spec: { exits: [{ id: "a" }] }, market: "So111", ms: 12 }));
  const s = await stats();
  assert.equal(s.total, 1);
  assert.equal(s.orders, 1);
  assert.equal(s.withExit, 1);
});

test("an order with no exits counts as an order and not as protected", async () => {
  // The number the product lives on: a buy with no stop is the thing cipher
  // exists to prevent, so it must never be counted as one that had one.
  await record(entry({ spec: { exits: [] } }));
  await record(entry({ spec: {} }));
  const s = await stats();
  assert.equal(s.orders, 2);
  assert.equal(s.withExit, 0);
});

test("outcomes and readers are counted separately", async () => {
  await record(entry({ outcome: "executed", reader: "grammar" }));
  await record(entry({ outcome: "refused", reader: "model", kind: "refusal", reason: "outOfScope" }));
  await record(entry({ outcome: "asked", reader: "grammar", kind: "clarify" }));
  const s = await stats();
  assert.equal(s.total, 3);
  assert.deepEqual(s.outcomes, { executed: 1, refused: 1, asked: 1 });
  assert.deepEqual(s.readers, { grammar: 2, model: 1 });
});

test("a signed-out sentence is kept, with no user attached", async () => {
  await record(entry({ userId: null, text: "ape 200 into bonk" }));
  const s = await stats();
  assert.equal(s.total, 1);
});

test("the failure list is the working list: refused and failed, newest first", async () => {
  const t = Date.now();
  await record(entry({ at: t - 2000, text: "old one", outcome: "refused", kind: "refusal" }));
  await record(entry({ at: t - 1000, text: "newer one", outcome: "failed" }));
  await record(entry({ at: t, text: "a good one", outcome: "executed" }));

  const worst = await failures();
  assert.deepEqual(worst.map((f) => f.text), ["newer one", "old one"]);
});

test("an over-long sentence is truncated, never rejected silently", async () => {
  await record(entry({ text: "x".repeat(MAX_TEXT + 500) }));
  const s = await stats();
  assert.equal(s.total, 1);
});

test("an empty sentence is not stored", async () => {
  await record(entry({ text: "   " }));
  assert.equal((await stats()).total, 0);
});

test("stats only counts the window asked for", async () => {
  await record(entry({ at: Date.now() - 40 * 86_400_000 }));
  await record(entry());
  assert.equal((await stats(30)).total, 1);
  assert.equal((await stats(90)).total, 2);
});
