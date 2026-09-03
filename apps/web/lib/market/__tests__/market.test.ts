import { test } from "node:test";
import assert from "node:assert/strict";
import { pickDeepestPair, normalise } from "../dexscreener.ts";
import { toCandles } from "../geckoterminal.ts";
import { toTrades } from "../trades.ts";

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
  // Counters genuinely are zero when absent.
  assert.equal(s.volume24h, 0);
  assert.equal(s.buys24h, 0);
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
  assert.equal(s.change24h, 3.47);
  assert.equal(s.buys24h, 5337);
  assert.equal(s.sells24h, 7387);
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
