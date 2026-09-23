import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { collisions, collisionsFor, RESERVED } from "../collisions.ts";
import type { Registry } from "../../market/registry.ts";

/**
 * The check that should have caught PUMP before a user did.
 *
 * Every bug in the prompt bar on 23 Sep 2026 was found by the person using the
 * product, not by the 5,085-row corpus — because that corpus uses four assets
 * chosen by hand, and a corpus written from imagination tests imagination.
 * This one is written from the live market instead.
 */

const registry: Registry = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../../../public/tokens.json"), "utf8"),
);

test("no live ticker changes how a sentence parses", () => {
  /*
   * `pumps?` is a condition word and PUMP is a $3.7B token, so "buy $500 of
   * PUMP" — no condition in it anywhere — read as a sentence that says wait,
   * and every order on that token came back asking for a trigger price.
   *
   * This fails the moment the registry is refreshed with a token whose name
   * the compiler already uses for something, which is the only way to find
   * out before somebody tries to trade it.
   */
  const found = collisions(registry.tokens.map((t) => t.symbol));
  assert.deepEqual(
    found.map((c) => `${c.sentence}  →  ${c.got}  (control: ${c.control})`),
    [],
  );
});

test("the sweep can actually detect a collision", () => {
  /* A check that has never failed is not known to work. "when" is a condition
     word, so a token by that name must register — if this ever passes an empty
     array, the sweep above is measuring nothing. */
  assert.ok(
    collisionsFor("WHEN").length > 0,
    "a ticker named after a condition word must be detected",
  );
  assert.equal(collisionsFor("ZZQX").length, 0, "the control must not collide with itself");
});

test("reserved words that would break if somebody minted them", () => {
  /*
   * NOT A FAILURE, a watch list. Most are honestly ambiguous — "sell all my
   * half" has no reading a person would agree on and refusing it is right.
   * This pins the list so that a change to the grammar which quietly makes it
   * LONGER shows up in a diff, and so the day one of these is minted there is
   * something to check against.
   */
  const affected = [...new Set(collisions(RESERVED).map((c) => c.ticker))].sort();
  assert.deepEqual(affected, [
    "all", "and", "at", "everything", "exit", "for", "half", "into", "of",
    "once", "quarter", "rest", "stop", "then", "third", "when", "with", "worth",
  ]);
});
