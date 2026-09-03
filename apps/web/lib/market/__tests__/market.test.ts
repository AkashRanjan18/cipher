import { test } from "node:test";
import assert from "node:assert/strict";
import { pickDeepestPair, normalise } from "../dexscreener.ts";
import { toCandles } from "../geckoterminal.ts";
import { toTrades } from "../trades.ts";
import { toPoolSummaries, isMintAddress } from "../discover.ts";
import { foldLivePrice } from "../live.ts";
import { toSecurity } from "../security.ts";

const pair = (over: Record<string, unknown> = {}) => ({
  pairAddress: "P1",
  dexId: "orca",
  baseToken: { symbol: "BONK", name: "Bonk" },
  priceUsd: "0.000003011",
  ...over,
});

test("picks the deepest pool, not the first", () => {
  const chosen = pickDeepestPair([
    pair({ pairAddress: "shallow", liquidity: { usd: 2_000 } }),
    pair({ pairAddress: "deep", liquidity: { usd: 205_762 } }),
    pair({ pairAddress: "mid", liquidity: { usd: 50_000 } }),
  ])!;
  // Taking [0] would quote a $2k pool as the token's price.
  assert.equal(chosen.pairAddress, "deep");
});

test("a pool with no liquidity field does not win by default", () => {
  const chosen = pickDeepestPair([
    pair({ pairAddress: "unknown" }),
    pair({ pairAddress: "real", liquidity: { usd: 100 } }),
  ])!;
  assert.equal(chosen.pairAddress, "real");
});

test("no pairs returns null rather than throwing", () => {
  assert.equal(pickDeepestPair([]), null);
});

test("tiny prices survive the string to number conversion", () => {
  const s = normalise("MINT", pair({ priceUsd: "0.000003011" }));
  assert.equal(s.priceUsd, 0.000003011);
});

test("absent market cap is null, never zero", () => {
  // Zero would render as "$0 market cap", which is a claim. Null is "unknown".
  const s = normalise("MINT", pair());
  assert.equal(s.marketCap, null);
  assert.equal(s.fdv, null);
  // Counters genuinely are zero when absent; a change is not.
  assert.equal(s.windows.h24.volume, 0);
  assert.equal(s.windows.h24.buys, 0);
  assert.equal(s.windows.h24.change, null);
});

test("normalise maps every field", () => {
  const s = normalise("MINT", pair({
    marketCap: 264_974_787,
    liquidity: { usd: 205_762.47 },
    volume: { h24: 361_484.38 },
    priceChange: { h24: 3.47 },
    txns: { h24: { buys: 5337, sells: 7387 } },
  }));
  assert.equal(s.mint, "MINT");
  assert.equal(s.symbol, "BONK");
  assert.equal(s.dex, "orca");
  assert.equal(s.marketCap, 264_974_787);
  assert.equal(s.windows.h24.change, 3.47);
  assert.equal(s.windows.h24.buys, 5337);
  assert.equal(s.windows.h24.sells, 7387);
});

test("every window is present even when the source reports only one", () => {
  // The About panel renders all four; a missing key would crash the row
  // rather than render an unknown.
  const s = normalise("MINT", pair({ priceChange: { h24: 3.47 } }));
  assert.deepEqual(Object.keys(s.windows), ["m5", "h1", "h6", "h24"]);
  assert.equal(s.windows.m5.change, null);
  assert.equal(s.windows.h24.change, 3.47);
});

test("candles are sorted ascending — the API returns newest first", () => {
  const out = toCandles([
    [1788433200, 2.98e-6, 3.01e-6, 2.96e-6, 3.0e-6, 5697],
    [1788429600, 2.97e-6, 2.99e-6, 2.96e-6, 2.98e-6, 5568],
    [1788426000, 3.0e-6, 3.01e-6, 2.97e-6, 2.97e-6, 19141],
  ]);
  assert.deepEqual(out.map((c) => c.time), [1788426000, 1788429600, 1788433200]);
  // Chart libraries throw or render a scribble on unsorted input.
  for (let i = 1; i < out.length; i++) {
    assert.ok(out[i].time > out[i - 1].time);
  }
});

test("candle rows map positionally", () => {
  const [c] = toCandles([[1788426000, 1, 2, 0.5, 1.5, 999]]);
  assert.deepEqual(c, { time: 1788426000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 999 });
});

test("empty candle list is empty, not an error", () => {
  assert.deepEqual(toCandles([]), []);
});

test("a buy reads price from the token received, not the token spent", () => {
  const [t] = toTrades([
    {
      id: "x1",
      attributes: {
        block_timestamp: "2026-09-03T12:00:00Z",
        kind: "buy",
        // SOL went in, BONK came out. The charted price is BONK's.
        price_from_in_usd: "101.28",
        price_to_in_usd: "0.00000303",
        volume_in_usd: "156.5",
        tx_from_address: "8PcgDzzguWiFnEZ2CaGkTaMyVAHcS7fCnHUubc12HW2U",
        tx_hash: "abc",
      },
    },
  ]);
  assert.equal(t.side, "buy");
  assert.equal(t.priceUsd, 0.00000303);
});

test("a sell reads price from the token spent", () => {
  const [t] = toTrades([
    {
      id: "x2",
      attributes: {
        block_timestamp: "2026-09-03T12:00:00Z",
        kind: "sell",
        price_from_in_usd: "0.00000303",
        price_to_in_usd: "101.28",
        volume_in_usd: "156.5",
        tx_from_address: "8Pcg",
        tx_hash: "def",
      },
    },
  ]);
  assert.equal(t.side, "sell");
  assert.equal(t.priceUsd, 0.00000303);
});

test("an unrecognised kind is treated as a sell, never a buy", () => {
  // Overstating demand is the direction that costs money.
  const [t] = toTrades([
    {
      id: "x3",
      attributes: {
        block_timestamp: "2026-09-03T12:00:00Z",
        kind: "",
        price_from_in_usd: "0.0000030",
        price_to_in_usd: "101.28",
        volume_in_usd: "1",
        tx_from_address: "a",
        tx_hash: "b",
      },
    },
  ]);
  assert.equal(t.side, "sell");
});

const gpool = (over: Record<string, unknown> = {}) => ({
  attributes: {
    address: "P9",
    name: "BEN / USDC",
    pool_created_at: "2026-09-03T08:41:22Z",
    base_token_price_usd: "0.00043955",
    price_change_percentage: { h1: "16.893", h24: "648.48" },
    volume_usd: { h24: "3269338.6" },
    reserve_in_usd: "72431.43",
    ...over,
  },
  relationships: {
    base_token: { data: { id: "solana_43uJZGxfZcsiL29k1vpwd7H6up5qgMAoU1aMb5Rmpump" } },
    dex: { data: { id: "pumpswap" } },
  },
});

test("the network prefix is stripped off the base token id", () => {
  // /trade/[mint] routes on the bare mint; "solana_<mint>" would 404.
  const [p] = toPoolSummaries([gpool()]);
  assert.equal(p.mint, "43uJZGxfZcsiL29k1vpwd7H6up5qgMAoU1aMb5Rmpump");
});

test("the base symbol is the left half of the pool name", () => {
  const [p] = toPoolSummaries([gpool()]);
  assert.equal(p.symbol, "BEN");
});

test("unparseable numbers become zero, never NaN", () => {
  // NaN reaches the DOM as the string "NaN" and reads as a crash.
  const [p] = toPoolSummaries([gpool({ reserve_in_usd: "" })]);
  assert.equal(p.liquidityUsd, 0);
});

test("a pool with no creation time has a null age, not epoch zero", () => {
  const [p] = toPoolSummaries([gpool({ pool_created_at: null })]);
  assert.equal(p.createdAt, null);
});

test("a pasted mint is recognised, a ticker is not", () => {
  // A ticker goes to text search; a mint is resolved directly, because text
  // search on an address returns nothing.
  assert.ok(isMintAddress("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"));
  assert.ok(!isMintAddress("bonk"));
});

test("base58 excludes the ambiguous glyphs", () => {
  // 0/O and I/l are absent from the alphabet so a mispaste fails here rather
  // than resolving to a different account — i.e. buying the wrong token.
  assert.ok(!isMintAddress("0ezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"));
  assert.ok(!isMintAddress("IezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"));
});

const bar = { time: 3600, open: 10, high: 12, low: 9, close: 11, volume: 5 };

test("a tick inside the bucket extends the forming bar", () => {
  // 3900s sits inside the 3600-7199 hour bucket, so the bar is extended.
  const out = foldLivePrice(bar, 13, 3600, 3_900_000);
  assert.equal(out.time, 3600);
  assert.equal(out.open, 10, "the open never moves once a bar has started");
  assert.equal(out.high, 13);
  assert.equal(out.close, 13);
});

test("a tick below the low extends the low, not the high", () => {
  const out = foldLivePrice(bar, 4, 3600, 3_900_000);
  assert.equal(out.low, 4);
  assert.equal(out.high, 12);
});

test("a tick past the boundary opens a new bar", () => {
  const out = foldLivePrice(bar, 13, 3600, 7_300_000);
  assert.equal(out.time, 7200);
  // A fresh bar has no range yet: all four values are the first print.
  assert.deepEqual(
    [out.open, out.high, out.low, out.close],
    [13, 13, 13, 13],
  );
});

test("a new bar claims no volume it has not seen", () => {
  // Volume is only known at the next server fetch; inventing one would put a
  // number on the chart that no trade produced.
  assert.equal(foldLivePrice(bar, 13, 3600, 7_300_000).volume, 0);
});

test("a closed bar is never rewritten by a late tick", () => {
  /*
   * If a stale price arrives after the bar has rolled, it must open the next
   * bar rather than restate a settled one — otherwise the chart disagrees
   * with the exchange about what already happened.
   */
  const out = foldLivePrice(bar, 999, 3600, 10_800_000);
  assert.equal(out.time, 10800);
  assert.equal(out.high, 999);
});

test("a revoked authority is the safe state, not a missing value", () => {
  /*
   * null means revoked — the deployer can no longer mint or freeze. Coercing
   * it to a string would invert the meaning and paint a safe token as
   * dangerous; coercing the reverse would be far worse.
   */
  const s = toSecurity({ mintAuthority: null, freezeAuthority: null }, {});
  assert.equal(s.mintAuthority, null);
  assert.equal(s.freezeAuthority, null);
});

test("a live mint authority is preserved verbatim", () => {
  const s = toSecurity(
    { mintAuthority: "Deployer111", freezeAuthority: null },
    {},
  );
  assert.equal(s.mintAuthority, "Deployer111");
});

test("LP lock comes from the summary, not the per-market report", () => {
  // The full report has no top-level lpLockedPct; reading one defaulted to 0
  // and claimed the pool could be drained when it could not.
  const s = toSecurity(
    { mintAuthority: null, freezeAuthority: null },
    { lpLockedPct: 22.67 },
  );
  assert.equal(s.lpLockedPct, 22.67);
});

test("a missing summary leaves LP at zero rather than inventing a lock", () => {
  // Erring toward "unlocked" is the safe direction: it warns on a token that
  // may be fine, instead of reassuring on one that is not.
  const s = toSecurity({ mintAuthority: null, freezeAuthority: null }, {});
  assert.equal(s.lpLockedPct, 0);
});

test("holders default insider to false, never true", () => {
  const s = toSecurity(
    {
      mintAuthority: null,
      freezeAuthority: null,
      topHolders: [{ address: "A1", pct: 8.2 }],
    },
    {},
  );
  assert.equal(s.topHolders[0].insider, false);
});

test("duplicate timestamps are dropped, not just sorted next to each other", () => {
  /*
   * lightweight-charts throws "data must be asc ordered by time" on a repeat
   * and takes the whole page down. Sorting puts duplicates adjacent; it does
   * not remove them. GeckoTerminal does emit repeats.
   */
  const out = toCandles([
    [300, 3, 3, 3, 3, 3],
    [200, 2, 2, 2, 2, 2],
    [200, 9, 9, 9, 9, 9],
    [100, 1, 1, 1, 1, 1],
  ]);
  assert.deepEqual(out.map((c) => c.time), [100, 200, 300]);
  for (let i = 1; i < out.length; i++) {
    assert.ok(out[i].time > out[i - 1].time, "times must strictly increase");
  }
});

test("the freshest read of a repeated bar wins", () => {
  // Rows arrive newest-first, so the first occurrence is the latest data.
  const out = toCandles([
    [200, 9, 9, 9, 9, 9],
    [200, 2, 2, 2, 2, 2],
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].close, 9);
});
