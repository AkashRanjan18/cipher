import { test } from "node:test";
import assert from "node:assert/strict";
import { gate, isOpenPath, readGeo } from "../restricted.ts";

const H = (o: Record<string, string>) => ({
  get: (n: string) => o[n.toLowerCase()] ?? null,
});

test("US is blocked", () => {
  const d = gate({ country: "US" }, true);
  assert.equal(d.allow, false);
  assert.equal(d.allow === false && d.reason, "restricted-country");
});

test("lowercase and padded country codes still match", () => {
  assert.equal(gate({ country: " us " }, true).allow, false);
});

test("OFAC jurisdictions are blocked", () => {
  for (const c of ["KP", "IR", "SY", "CU"]) {
    assert.equal(gate({ country: c }, true).allow, false, `${c} should be blocked`);
  }
});

test("Crimea blocked, rest of Ukraine allowed", () => {
  assert.equal(gate({ country: "UA", region: "43" }, true).allow, false);
  assert.equal(gate({ country: "UA", region: "32" }, true).allow, true); // Kyiv oblast
});

test("ordinary countries pass", () => {
  for (const c of ["IN", "GB", "DE", "SG", "AE", "BR"]) {
    assert.equal(gate({ country: c }, true).allow, true, `${c} should be allowed`);
  }
});

test("unknown origin: fails closed in prod, open in dev", () => {
  assert.equal(gate({ country: null }, true).allow, false);
  assert.equal(gate({ country: null }, false).allow, true);
  assert.equal(gate({}, true).allow, false);
});

test("scanner and landing stay open, app is gated", () => {
  for (const p of ["/", "/w/So11111", "/api/scan/abc", "/restricted", "/legal/terms", "/_next/static/x.js"]) {
    assert.equal(isOpenPath(p), true, `${p} should be open`);
  }
  for (const p of ["/app", "/app/rules", "/api/trade", "/api/rules/arm", "/settings"]) {
    assert.equal(isOpenPath(p), false, `${p} should be gated`);
  }
});

test("reads geo from Vercel or Cloudflare headers", () => {
  assert.equal(readGeo(H({ "x-vercel-ip-country": "US" })).country, "US");
  assert.equal(readGeo(H({ "cf-ipcountry": "IN" })).country, "IN");
  assert.equal(readGeo(H({})).country, null);
});
