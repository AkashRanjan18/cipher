import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { candlesForPool, poolFor, RateLimited } from "../candles.ts";

/**
 * Candles from GeckoTerminal, and the invariant the chart library asserts on.
 *
 * lightweight-charts does not cope with bad ordering — it throws, and the
 * throw takes the whole terminal down behind a red overlay. So the shape of
 * the series is not a detail of this file; it is the contract.
 */

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const POOL = "5zpyutJu9ee6jFymDGoK7F6S5Kczqtc9FomP3ueKuyA9";
const MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

function serveOhlcv(rows: number[][]): void {
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({ data: { attributes: { ohlcv_list: rows } } }),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as typeof fetch;
}

function servePools(pools: { id: string; reserve: string; base?: string }[]): void {
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        data: pools.map((p) => ({
          id: p.id,
          attributes: { reserve_in_usd: p.reserve },
          /* Defaults to our mint: most tests are about depth, not sides. */
          relationships: { base_token: { data: { id: `solana_${p.base ?? MINT}` } } },
        })),
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as typeof fetch;
}

/* ──────────────────────────── the ordering contract ────────────────────── */

test("candles come back oldest first, though upstream sends newest first", async () => {
  serveOhlcv([
    [300, 3, 3, 3, 3, 30],
    [200, 2, 2, 2, 2, 20],
    [100, 1, 1, 1, 1, 10],
  ]);
  const out = await candlesForPool(POOL, "1h");
  assert.deepEqual(out.map((c) => c.time), [100, 200, 300]);
});

test("a repeated bucket is collapsed, and the fresher copy survives", async () => {
  /*
   * THE BUG THAT PUT A RED OVERLAY OVER THE WHOLE APP:
   *
   *   Assertion failed: data must be asc ordered by time,
   *   index=299, time=1789290840, prev time=1789290840
   *
   * lightweight-charts requires STRICTLY ascending time. GeckoTerminal repeats
   * the bucket that is still forming, so a plain reverse carried a duplicate
   * straight into setData. Newest-first means the FIRST copy seen is the most
   * recently updated, and for a forming bucket it is the only one holding the
   * current close.
   */
  serveOhlcv([
    [300, 9, 9, 9, 9.5, 99], // the live bucket, updated
    [300, 3, 3, 3, 3.0, 30], // the same bucket, a moment earlier
    [200, 2, 2, 2, 2.0, 20],
  ]);
  const out = await candlesForPool(POOL, "1h");
  assert.deepEqual(out.map((c) => c.time), [200, 300]);
  assert.equal(out[1].close, 9.5, "the stale copy of the live bucket won");
});

test("whatever the input, the output is strictly ascending", async () => {
  serveOhlcv([
    [200, 1, 1, 1, 1, 0],
    [400, 1, 1, 1, 1, 0],
    [200, 1, 1, 1, 1, 0],
    [100, 1, 1, 1, 1, 0],
    [400, 1, 1, 1, 1, 0],
    [300, 1, 1, 1, 1, 0],
  ]);
  const out = await candlesForPool(POOL, "1h");
  for (let i = 1; i < out.length; i++) {
    assert.ok(out[i].time > out[i - 1].time, `index ${i} is not after ${i - 1}`);
  }
  assert.deepEqual(out.map((c) => c.time), [100, 200, 300, 400]);
});

test("rows with an unusable time or close are dropped, not charted as zero", async () => {
  serveOhlcv([
    [100, 1, 1, 1, 1, 10],
    [NaN, 2, 2, 2, 2, 20],
    [300, 3, 3, 3, NaN, 30],
    [400, 4, 4, 4, 4, 40],
  ]);
  const out = await candlesForPool(POOL, "1h");
  assert.deepEqual(out.map((c) => c.time), [100, 400]);
});

test("a missing volume is zero rather than undefined", async () => {
  serveOhlcv([[100, 1, 1, 1, 1]]);
  const [c] = await candlesForPool(POOL, "1h");
  assert.equal(c.volume, 0);
});

test("an empty series is empty, not a crash", async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ data: {} }), { status: 200 })) as typeof fetch;
  assert.deepEqual(await candlesForPool(POOL, "1h"), []);
});

test("an upstream failure throws rather than drawing an empty chart", async () => {
  globalThis.fetch = (async () => new Response("no", { status: 500 })) as typeof fetch;
  // Empty and unavailable are different claims. A token with no history and a
  // broken upstream must not look identical to the user.
  await assert.rejects(() => candlesForPool(POOL, "1h"), /500/);
});

test("being rate limited is its own failure, not a broken token", async () => {
  /*
   * GeckoTerminal allows 30 requests a minute across the whole deployment and
   * a cold chart costs two, so opening several new tokens quickly hits it —
   * measured, not guessed: fourteen back to back produced seven failures.
   * "Try again in a moment" is true and actionable; "unavailable" sends the
   * user away from a token that is fine.
   */
  globalThis.fetch = (async () => new Response("slow down", { status: 429 })) as typeof fetch;
  await assert.rejects(() => candlesForPool(POOL, "1h"), RateLimited);
});

/* ─────────────────────────────── pool choice ───────────────────────────── */

test("the deepest pool is chosen, not the first one listed", async () => {
  /*
   * GeckoTerminal's default ordering put a $272k Bonk/SOL pool at the top of
   * twenty. Charting the shallowest venue draws wicks that exist nowhere else,
   * because a thin pool prints prices no size could ever get.
   */
  servePools([
    { id: "solana_shallow", reserve: "272487.38" },
    { id: "solana_deep", reserve: "4120000.00" },
    { id: "solana_middle", reserve: "900000.00" },
  ]);
  assert.equal(await poolFor(MINT), "deep");
});

test("the network prefix is stripped, because the ohlcv path wants the bare address", async () => {
  servePools([{ id: "solana_5zpyutJu9ee6jFymDGoK7F6S5Kczqtc9FomP3ueKuyA9", reserve: "1" }]);
  assert.equal(await poolFor(MINT), "5zpyutJu9ee6jFymDGoK7F6S5Kczqtc9FomP3ueKuyA9");
});

test("a pool where the token is the QUOTE side is never chosen, however deep", async () => {
  /*
   * THE BUG THAT DREW THE WRONG COIN. A pool's OHLCV is the price of its BASE
   * token. SOL's deepest pool is `WOFI / SOL` at $90M — deeper than either
   * SOL/USDC pool — so choosing on depth alone charted WOFI's price under the
   * name SOL, on a plausible-looking axis. Nothing about it looked broken.
   */
  servePools([
    { id: "solana_wofi_sol", reserve: "90344312", base: "vbvtJZrWdNDdWOFIMINT1111111111111111111111" },
    { id: "solana_sol_usdc", reserve: "31204022" },
  ]);
  assert.equal(await poolFor(MINT), "sol_usdc");
});

test("a token that is the base of nothing gets no chart rather than someone else's", async () => {
  servePools([{ id: "solana_other", reserve: "99999999", base: "SomeOtherMint111111111111111111111111111111" }]);
  assert.equal(await poolFor(MINT), null);
});

test("a token with no pools is null, and never reaches the ohlcv call", async () => {
  servePools([]);
  assert.equal(await poolFor(MINT), null);
});

test("something that is not a mint is refused before any request is made", async () => {
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  assert.equal(await poolFor("SOLUSDT"), null);
  assert.equal(called, false, "a Binance pair was sent to GeckoTerminal");
});
