import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRows, type Row } from "../rows.ts";

/* Entry around $100, so "below" and "above" have an unambiguous meaning. */
const ENTRY = 100;
const row = (over: Partial<Row> = {}): Row => ({ kind: "sl", value: "", amount: "", ...over });

test("a bare number is a percentage, and a $ makes it a price", () => {
  const { rules } = parseRows(
    [row({ kind: "sl", value: "10" }), row({ kind: "sl", value: "$90" })],
    ENTRY,
  );
  assert.deepEqual(rules[0].trigger, { kind: "drawdownFromEntry", percent: 10 });
  assert.deepEqual(rules[1].trigger, { kind: "priceAbsolute", value: 90 });
});

test("a percent target becomes a MULTIPLE, so it binds to the real fill", () => {
  // Not a price computed from the estimate on screen: on a thin token the
  // fill and the estimate differ by more than the target does.
  const { rules } = parseRows([row({ kind: "tp", value: "50%" })], ENTRY);
  assert.deepEqual(rules[0].trigger, { kind: "priceMultiple", value: 1.5 });
});

test("a minus sign on a stop is read as the size, not as a negative", () => {
  const { rules } = parseRows([row({ kind: "sl", value: "-10%" })], ENTRY);
  assert.deepEqual(rules[0].trigger, { kind: "drawdownFromEntry", percent: 10 });
});

test("each row sells its own slice, and blank means all of it", () => {
  const { rules } = parseRows(
    [row({ kind: "tp", value: "50", amount: "30" }), row({ kind: "sl", value: "10" })],
    ENTRY,
  );
  assert.deepEqual(rules[0].amount, { kind: "percentOfPosition", value: 30 });
  assert.deepEqual(rules[1].amount, { kind: "percentOfPosition", value: 100 });
});

test("a price on the wrong side of the entry is refused, not armed", () => {
  assert.match(parseRows([row({ kind: "sl", value: "$120" })], ENTRY).problem!, /below \$100/);
  assert.match(parseRows([row({ kind: "tp", value: "$80" })], ENTRY).problem!, /above \$100/);
});

test("a trailing stop is a percentage off the high and nothing else", () => {
  assert.deepEqual(parseRows([row({ kind: "tsl", value: "25" })], ENTRY).rules[0].trigger, {
    kind: "trailingStop",
    percent: 25,
  });
  assert.match(parseRows([row({ kind: "tsl", value: "$90" })], ENTRY).problem!, /not a price/);
});

test("nonsense is named, and never armed", () => {
  assert.match(parseRows([row({ value: "abc" })], ENTRY).problem!, /not a number/);
  assert.match(parseRows([row({ value: "10", amount: "140" })], ENTRY).problem!, /1% and 100%/);
  assert.match(parseRows([row({ value: "150" })], ENTRY).problem!, /less than 100%/);
});

test("empty rows arm nothing at all", () => {
  const out = parseRows([row(), row({ kind: "tp" })], ENTRY);
  assert.equal(out.rules.length, 0);
  assert.equal(out.problem, null);
  assert.equal(out.summary, "");
});

test("a ladder past 100% warns and still arms — the last rung waits", () => {
  const out = parseRows(
    [
      row({ kind: "tp", value: "50", amount: "60" }),
      row({ kind: "tp", value: "100", amount: "60" }),
    ],
    ENTRY,
  );
  assert.equal(out.rules.length, 2);
  assert.equal(out.problem, null);
  assert.match(out.warning!, /120%/);
});

test("the summary says what was set, for the receipt", () => {
  const out = parseRows(
    [row({ kind: "sl", value: "10", amount: "50" }), row({ kind: "tp", value: "100" })],
    ENTRY,
  );
  assert.match(out.summary, /Stop −10% on 50%/);
  assert.match(out.summary, /target \+100%/);
});
