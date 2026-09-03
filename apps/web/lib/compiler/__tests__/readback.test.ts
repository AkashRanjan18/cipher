import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWithGrammar } from "../grammar.ts";
import { readback, readbackText } from "../readback.ts";

const compile = (s: string) => readback(parseWithGrammar(s)!);
const line = (s: string, label: string) => compile(s).find((l) => l.label === label)!;

test("the canonical sentence renders only what matters", () => {
  const out = compile("buy me $500 of bonk, sell a third at 2x and stop the rest at -50%");
  // No SLIPPAGE or ROUTING: both are at their defaults and the user never
  // mentioned them, so a line about them is noise.
  assert.deepEqual(out.map((l) => l.label), ["BUY", "THEN", "STOP"]);
  assert.equal(out[0].value, "$500 of BONK");
  assert.equal(out[1].value, "sell a third at 2× your entry");
  assert.equal(out[2].value, "sell everything if it falls 50% below your entry");
});

test("word fractions come back as words", () => {
  assert.match(line("sell half at 2x", "THEN").value, /sell half/);
  assert.match(line("sell a quarter at 2x", "THEN").value, /sell a quarter/);
  assert.match(line("sell 40% at 2x", "THEN").value, /sell 40%/);
});

test("slippage appears only when the user set it, as a consequence", () => {
  // Default: absent entirely.
  assert.equal(compile("buy $100 of wif").some((l) => l.label === "SLIPPAGE"), false);

  const l = line("buy $100 of wif, max 1% slippage", "SLIPPAGE");
  assert.equal(l.value, "up to 1%");
  assert.match(l.note!, /abandoned rather than filled worse/);
  // never raw basis points — nobody approves "300 bps" meaningfully
  assert.doesNotMatch(l.value + l.note!, /bps|basis point/i);
});

test("routing is silent when private, loud when public", () => {
  // Private is the default and the safe case — no line.
  assert.equal(compile("buy $100 of wif").some((l) => l.label === "ROUTING"), false);
  // Going public is a real downgrade; silence would hide it.
  assert.match(
    line("buy $100 of wif with public mempool", "ROUTING").note!,
    /you can be front-run/,
  );
});

test("an unconfirmed token is flagged", () => {
  assert.equal(line("buy $100 of wif", "BUY").note, "token not confirmed yet");
});

test("an entry with no exit says so plainly", () => {
  const l = line("buy $100 of wif", "AFTER");
  assert.equal(l.value, "nothing");
  assert.match(l.note!, /will not sell itself/);
});

test("a ladder renders in order", () => {
  const out = compile("sell a third at 2x, sell a third at 5x");
  const thens = out.filter((l) => l.label === "THEN");
  assert.equal(thens.length, 2);
  assert.match(thens[0].value, /2×/);
  assert.match(thens[1].value, /5×/);
});

test("stop and trailing stop are distinguished", () => {
  assert.match(line("stop at -40%", "STOP").note!, /does not follow the price up/);
  assert.match(line("trail 30%", "STOP").note!, /resets if you exit/);
});

test("large numbers are grouped", () => {
  assert.equal(line("buy $1.5k of bonk", "BUY").value, "$1,500 of BONK");
});

test("text form is loggable — it is what the user approved", () => {
  const t = readbackText(parseWithGrammar("buy $100 of wif, max 2% slippage")!);
  assert.match(t, /^BUY \$100 of WIF/);
  assert.match(t, /SLIPPAGE up to 2%/);
});
