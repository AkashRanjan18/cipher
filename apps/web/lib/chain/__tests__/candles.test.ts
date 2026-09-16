import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { candlesFor, RateLimited } from "../candles.ts";

/**
 * Candles from Jupiter, and the two things that must stay true about them.
 *
 * ONE is the renderer's contract. lightweight-charts does not cope with bad
 * ordering — it throws, and the throw takes the whole terminal down behind a
 * red overlay. So the shape of the series is not a detail of this file.
 *
 * TWO is the wick. A bar is folded from finer candles and its extremes come
 * from ROUTED prices — the opens and closes of those finer candles — never
 * from their own highs and lows, which are the cross-pool extremes that made
 * cipher's 1-minute wicks six times Binance's. The measurements behind that
 * are in candles.ts; the tests below are what stop it silently regressing,
 * because the failure mode is a chart that still draws and is merely wrong.
 *
 * The source moved off GeckoTerminal on 16 Sep 2026 after it reported an
 * hourly high of $117.65 for SOL that neither Binance ($102.87) nor Jupiter
 * ($103.01) saw. The tests that used to cover choosing a pool are gone with
 * it: Jupiter charts a token, so there is no pool to choose.
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

/** Every URL asked for, in order, so the requests themselves can be asserted. */
let urls: string[] = [];

/** Serves one body to every request. */
function serve(candles: unknown[]): void {
  urls = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return new Response(JSON.stringify({ candles }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

/** Serves a different body to each successive request. */
function serveEach(bodies: unknown[][]): void {
  urls = [];
  let n = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    const candles = bodies[Math.min(n++, bodies.length - 1)];
    return new Response(JSON.stringify({ candles }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

const param = (i: number, k: string) => new URL(urls[i]).searchParams.get(k);

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
  assert.ok(Number(param(0, "to")) > 1e12, `expected milliseconds, got ${param(0, "to")}`);
});

test("each interval asks for the FINER one it is folded from", async () => {
  const expected: Record<string, [fine: string, per: number]> = {
    "1m": ["15_SECOND", 4],
    "5m": ["1_MINUTE", 5],
    "15m": ["5_MINUTE", 3],
    "1h": ["15_MINUTE", 4],
    "4h": ["1_HOUR", 4],
    "1d": ["4_HOUR", 6],
  };
  for (const [ours, [fine, per]] of Object.entries(expected)) {
    serve([row(1)]);
    await candlesFor(MINT, ours as never, 100);
    assert.equal(param(0, "interval"), fine, `${ours} should fold ${fine}`);
    assert.equal(param(0, "candles"), String(100 * per), `${ours} needs ${per} per bar`);
  }
});

test("the ask never exceeds Jupiter's 2000-candle ceiling", async () => {
  // Asking for more returns a 400, which would blank the chart entirely.
  serve([row(1)]);
  await candlesFor(MINT, "1d", 1000); // 1000 * 6 = 6000
  assert.equal(param(0, "candles"), "2000");
});

test("the default 300 bars stays inside the ceiling on every interval", async () => {
  // If it did not, the cap above would silently shorten the chart instead.
  for (const iv of ["1m", "5m", "15m", "1h", "4h", "1d"] as const) {
    serve([row(1)]);
    await candlesFor(MINT, iv);
    assert.ok(Number(param(0, "candles")) <= 2000, `${iv} asks for ${param(0, "candles")}`);
  }
});

test("never returns more bars than asked for, and keeps the NEWEST ones", async () => {
  /*
   * Jupiter emits a fine candle where there was trading, not on every tick of
   * the clock, so on a thin token the fold reaches back further than the
   * request implies — BONK folded to 582 bars against a request for 300. The
   * recent end is the end that matters, so the surplus comes off the front.
   */
  serve(Array.from({ length: 50 }, (_, i) => row(HOUR + i * 3600, i)));

  const out = await candlesFor(MINT, "1h", 10);
  assert.equal(out.length, 10);
  assert.equal(out[0].time, HOUR + 40 * 3600);
  assert.equal(out.at(-1)!.time, HOUR + 49 * 3600);
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

/* ──────────────────────────────── the fold ─────────────────────────────── */

const HOUR = 1_789_500_000 - (1_789_500_000 % 3600);

test("four quarter-hours become one hourly bar", async () => {
  serve([
    row(HOUR + 0, 10, { open: 10, close: 11 }),
    row(HOUR + 900, 11, { open: 11, close: 13 }),
    row(HOUR + 1800, 13, { open: 13, close: 9 }),
    row(HOUR + 2700, 9, { open: 9, close: 12 }),
  ]);

  const out = await candlesFor(MINT, "1h");
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], {
    time: HOUR, // the bar is stamped at the START of the hour
    open: 10, // first checkpoint's open
    close: 12, // last checkpoint's close
    high: 13, // highest routed price seen
    low: 9, // lowest routed price seen
    volume: 40, // summed, because the parts are disjoint
  });
});

test("the fine candles' OWN highs and lows never reach the bar", async () => {
  /*
   * THIS IS THE WHOLE POINT OF THE FILE. Jupiter's high is the maximum across
   * every pool holding the token, thin ones included, and nobody can trade it
   * — routing exists precisely to avoid the pool that printed it. Measured
   * against Binance over 300 minutes of SOL, taking those extremes made the
   * upper wick 6.4x too long while the bodies agreed to within a seventh.
   *
   * The 999 and 0.001 below are that number. If this test ever fails, the
   * chart went back to drawing prices no user of it could have got.
   */
  serve([
    row(HOUR + 0, 10, { open: 10, close: 11, high: 999, low: 0.001 }),
    row(HOUR + 900, 11, { open: 11, close: 12, high: 999, low: 0.001 }),
  ]);

  const [bar] = await candlesFor(MINT, "1h");
  assert.equal(bar.high, 12);
  assert.equal(bar.low, 10);
});

test("a bar is stamped at the start of its span, whatever the row's offset", async () => {
  serve([row(HOUR + 137, 5), row(HOUR + 3600 + 2999, 7)]);
  const out = await candlesFor(MINT, "1h");
  assert.deepEqual(
    out.map((c) => c.time),
    [HOUR, HOUR + 3600],
  );
});

test("out-of-order rows still open and close in the right places", async () => {
  // open is the FIRST checkpoint and close the LAST; both are meaningless if
  // the fold trusts arrival order.
  serve([
    row(HOUR + 1800, 0, { open: 13, close: 9 }),
    row(HOUR + 0, 0, { open: 10, close: 11 }),
    row(HOUR + 2700, 0, { open: 9, close: 12 }),
    row(HOUR + 900, 0, { open: 11, close: 13 }),
  ]);

  const [bar] = await candlesFor(MINT, "1h");
  assert.equal(bar.open, 10);
  assert.equal(bar.close, 12);
});

test("whatever the input, the output is strictly ascending", async () => {
  /*
   * lightweight-charts asserts on EQUAL timestamps, not only descending ones,
   * and the assertion is a full-screen error over the terminal rather than a
   * bad chart. Bucketing makes duplicates impossible by construction — two
   * rows in one hour are one bar — but the guarantee is asserted, not assumed.
   */
  serve([
    row(HOUR + 7200),
    row(HOUR),
    row(HOUR + 7200),
    row(HOUR + 3600),
    row(HOUR),
    row(HOUR + 3600),
  ]);

  const out = await candlesFor(MINT, "1h");
  for (let i = 1; i < out.length; i++) {
    assert.ok(out[i].time > out[i - 1].time, `index ${i} is not after ${i - 1}`);
  }
  assert.deepEqual(
    out.map((c) => c.time),
    [HOUR, HOUR + 3600, HOUR + 7200],
  );
});

test("rows with an unusable time or close are dropped, not charted as zero", async () => {
  serve([
    row(HOUR, 5),
    { ...row(0), time: NaN },
    { ...row(HOUR + 3600), close: NaN },
    row(HOUR + 7200, 7),
  ]);
  const out = await candlesFor(MINT, "1h");
  assert.deepEqual(
    out.map((c) => c.time),
    [HOUR, HOUR + 7200],
  );
});

test("a missing volume is zero rather than undefined", async () => {
  serve([{ time: HOUR, open: 1, high: 1, low: 1, close: 1 }]);
  const [c] = await candlesFor(MINT, "1h");
  assert.equal(c.volume, 0);
});

/* ─────────────────────────────── the fallback ──────────────────────────── */

test("a token too young for the fine interval falls back to the coarse one", async () => {
  /*
   * A mint four minutes old has no 15-minute history to fold into an hourly
   * bar. A chart-less token reads to the user as a broken token, so the second
   * request is worth it — and it only ever fires when the first found nothing.
   */
  serveEach([[], [row(HOUR, 42)]]);

  const out = await candlesFor(MINT, "1h");
  assert.equal(urls.length, 2);
  assert.equal(param(0, "interval"), "15_MINUTE");
  assert.equal(param(1, "interval"), "1_HOUR");
  assert.deepEqual(out.map((c) => c.close), [42]);
});

test("a token that is trading costs exactly one request", async () => {
  serve([row(HOUR, 1)]);
  await candlesFor(MINT, "1h");
  assert.equal(urls.length, 1);
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
