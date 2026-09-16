import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { candlesFor, RateLimited } from "../candles.ts";

/**
 * Candles from Jupiter, and the invariant the chart library asserts on.
 *
 * lightweight-charts does not cope with bad ordering — it throws, and the
 * throw takes the whole terminal down behind a red overlay. So the shape of
 * the series is not a detail of this file; it is the contract.
 *
 * The source moved off GeckoTerminal on 16 Sep 2026 after it reported an
 * hourly high of $117.65 for SOL that neither Binance ($102.87) nor Jupiter
 * ($103.01) saw. The tests that used to cover choosing a pool are gone with
 * it: Jupiter charts a token, so there is no pool to choose and no way to
 * choose it wrongly.
 */

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

interface Row {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

/** Remembers the last URL asked for, so the request itself can be asserted. */
let lastUrl = "";

function serve(candles: unknown[]): void {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    lastUrl = String(input);
    return new Response(JSON.stringify({ candles }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

function row(time: number, close = 1, over: Partial<Row> = {}): Row {
  return { time, open: close, high: close, low: close, close, volume: 10, ...over };
}

/* ─────────────────────────────── the request ───────────────────────────── */

test("the timestamp is sent in MILLISECONDS", async () => {
  /*
   * Seconds are accepted and come back with an empty series — a silent wrong
   * answer, which is the worst shape a unit bug can take. It cost twenty
   * minutes of thinking the endpoint did not exist.
   */
  serve([row(1)]);
  await candlesFor(MINT, "1h");
  const to = Number(new URL(lastUrl).searchParams.get("to"));
  assert.ok(to > 1e12, `expected milliseconds, got ${to}`);
});

test("every interval the UI offers maps to something Jupiter accepts", async () => {
  serve([row(1)]);
  const expected: Record<string, string> = {
    "1m": "1_MINUTE",
    "5m": "5_MINUTE",
    "15m": "15_MINUTE",
    "1h": "1_HOUR",
    "4h": "4_HOUR",
    "1d": "1_DAY",
  };
  for (const [ours, theirs] of Object.entries(expected)) {
    await candlesFor(MINT, ours as never);
    assert.equal(new URL(lastUrl).searchParams.get("interval"), theirs);
  }
});

test("a Binance pair is refused before any request is made", async () => {
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  assert.deepEqual(await candlesFor("SOLUSDT", "1h"), []);
  assert.equal(called, false, "a Binance pair was sent to Jupiter");
});

/* ──────────────────────────── the ordering contract ────────────────────── */

test("candles come back oldest first", async () => {
  serve([row(300, 3), row(100, 1), row(200, 2)]);
  const out = await candlesFor(MINT, "1h");
  assert.deepEqual(
    out.map((c) => c.time),
    [100, 200, 300],
  );
});

test("whatever the input, the output is strictly ascending", async () => {
  /*
   * lightweight-charts asserts on EQUAL timestamps, not only descending ones,
   * and the assertion is a full-screen error over the terminal rather than a
   * bad chart. Jupiter returns clean data today; this is the guarantee that a
   * feed changing its mind cannot take the app down.
   */
  serve([row(200), row(400), row(200), row(100), row(400), row(300)]);
  const out = await candlesFor(MINT, "1h");
  for (let i = 1; i < out.length; i++) {
    assert.ok(out[i].time > out[i - 1].time, `index ${i} is not after ${i - 1}`);
  }
  assert.deepEqual(
    out.map((c) => c.time),
    [100, 200, 300, 400],
  );
});

test("rows with an unusable time or close are dropped, not charted as zero", async () => {
  serve([row(100), { ...row(0), time: NaN }, { ...row(300), close: NaN }, row(400)]);
  const out = await candlesFor(MINT, "1h");
  assert.deepEqual(
    out.map((c) => c.time),
    [100, 400],
  );
});

test("a missing volume is zero rather than undefined", async () => {
  serve([{ time: 100, open: 1, high: 1, low: 1, close: 1 }]);
  const [c] = await candlesFor(MINT, "1h");
  assert.equal(c.volume, 0);
});

/* ──────────────────────────────── failures ─────────────────────────────── */

test("an empty series is empty, not a crash", async () => {
  serve([]);
  assert.deepEqual(await candlesFor(MINT, "1h"), []);
});

test("a body with no candles array is empty, not a crash", async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: "nope" }), { status: 200 })) as typeof fetch;
  assert.deepEqual(await candlesFor(MINT, "1h"), []);
});

test("an upstream failure throws rather than drawing an empty chart", async () => {
  globalThis.fetch = (async () => new Response("no", { status: 500 })) as typeof fetch;
  // Empty and unavailable are different claims. A token with no history and a
  // broken upstream must not look identical to the user.
  await assert.rejects(() => candlesFor(MINT, "1h"), /500/);
});

test("being rate limited is its own failure, not a broken token", async () => {
  globalThis.fetch = (async () => new Response("slow down", { status: 429 })) as typeof fetch;
  await assert.rejects(() => candlesFor(MINT, "1h"), RateLimited);
});
