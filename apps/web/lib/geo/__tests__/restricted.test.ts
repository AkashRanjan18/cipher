import { test } from "node:test";
import assert from "node:assert/strict";
import { gate, isOpenPath, isUsRestrictedPath, readGeo } from "../restricted.ts";

const H = (o: Record<string, string>) => ({
  get: (n: string) => o[n.toLowerCase()] ?? null,
});

const SPOT = "/trade";
const PERPS = "/perps";

test("US may trade spot", () => {
  assert.equal(gate({ country: "US" }, SPOT, true).allow, true);
  assert.equal(gate({ country: "US" }, "/api/orders", true).allow, true);
});

test("US may not touch derivatives or event markets", () => {
  for (const p of ["/perps", "/perps/SOL", "/api/perps/order", "/markets", "/api/markets/x"]) {
    const d = gate({ country: "US" }, p, true);
    assert.equal(d.allow, false, `${p} should be blocked for US`);
    assert.equal(d.allow === false && d.reason, "us-derivatives");
  }
});

test("sanctioned countries are blocked on every gated path", () => {
  for (const c of ["KP", "IR", "SY", "CU"]) {
    assert.equal(gate({ country: c }, SPOT, true).allow, false, `${c} spot`);
    assert.equal(gate({ country: c }, PERPS, true).allow, false, `${c} perps`);
  }
});

test("lowercase and padded codes still match", () => {
  assert.equal(gate({ country: " ir " }, SPOT, true).allow, false);
  assert.equal(gate({ country: " us " }, PERPS, true).allow, false);
});

test("Crimea blocked, rest of Ukraine allowed", () => {
  assert.equal(gate({ country: "UA", region: "43" }, SPOT, true).allow, false);
  assert.equal(gate({ country: "UA", region: "32" }, SPOT, true).allow, true);
});

test("ordinary countries pass everywhere", () => {
  for (const c of ["IN", "GB", "DE", "SG", "AE", "BR"]) {
    assert.equal(gate({ country: c }, SPOT, true).allow, true, `${c} spot`);
    assert.equal(gate({ country: c }, PERPS, true).allow, true, `${c} perps`);
  }
});

test("unknown origin only fails closed where the restriction is real", () => {
  // Blocking spot on a missing header would block everyone behind a CDN
  // that does not set it — a far larger group than US persons.
  assert.equal(gate({ country: null }, SPOT, true).allow, true);
  assert.equal(gate({ country: null }, PERPS, true).allow, false);
  // Locally no CDN sets geo headers at all.
  assert.equal(gate({ country: null }, PERPS, false).allow, true);
});

test("scanner and landing stay open, app is gated", () => {
  for (const p of ["/", "/w/So11111", "/api/scan/abc", "/restricted", "/legal/terms", "/_next/static/x.js"]) {
    assert.equal(isOpenPath(p), true, `${p} should be open`);
  }
  for (const p of ["/trade", "/perps", "/api/orders", "/settings"]) {
    assert.equal(isOpenPath(p), false, `${p} should be gated`);
  }
});

test("US-restricted paths are identified independently of country", () => {
  assert.equal(isUsRestrictedPath("/perps/SOL"), true);
  assert.equal(isUsRestrictedPath("/markets/abc"), true);
  assert.equal(isUsRestrictedPath("/trade"), false);
});

test("reads geo from Vercel or Cloudflare headers", () => {
  assert.equal(readGeo(H({ "x-vercel-ip-country": "US" })).country, "US");
  assert.equal(readGeo(H({ "cf-ipcountry": "IN" })).country, "IN");
  assert.equal(readGeo(H({})).country, null);
});
