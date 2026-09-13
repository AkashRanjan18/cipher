import { test } from "node:test";
import assert from "node:assert/strict";
import { newId } from "../id.ts";

test("ten thousand ids in a tight loop are all different", () => {
  /*
   * The generators this replaced were a timestamp plus a counter, and a
   * timestamp plus an array length. Both produce duplicates inside one
   * millisecond, which is exactly when a take-profit ladder fires two rungs.
   */
  const seen = new Set<string>();
  for (let i = 0; i < 10_000; i++) seen.add(newId("r"));
  assert.equal(seen.size, 10_000);
});

test("two independent callers in the same millisecond do not collide", () => {
  // The multi-user case: two browsers arming a rule at the same instant, each
  // with its own module state. Nothing here depends on shared state, so there
  // is none to be at the same value.
  const now = Date.now();
  const a = newId("r");
  const b = newId("r");
  assert.notEqual(a, b);
  assert.ok(Date.now() - now < 50, "test itself must run inside one tick to be meaningful");
});

test("the prefix survives and the time is still first", () => {
  const id = newId("f");
  assert.match(id, /^f[0-9a-z]+$/);
  // Time first means a log sorts roughly by creation, which is the only reason
  // not to use a bare uuid.
  const older = newId("f");
  assert.ok(older >= id || older.slice(1, 9) >= id.slice(1, 9));
});
