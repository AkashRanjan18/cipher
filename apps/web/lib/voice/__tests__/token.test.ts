import { test } from "node:test";
import assert from "node:assert/strict";
import { mintVoiceToken, TokenError, TOKEN_TTL_SECONDS } from "../token.ts";

/** A fetch that answers once with the given status and body, and records the call. */
function stub(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

test("a pass is minted with the admin key and a sixty-second life", async () => {
  const { impl, calls } = stub(200, { access_token: "tok", expires_in: 60 });
  const out = await mintVoiceToken("KEY", impl);

  assert.deepEqual(out, { token: "tok", expiresIn: 60 });
  assert.equal(calls[0].url, "https://api.deepgram.com/v1/auth/grant");
  /* `Token`, not `Bearer`, on THIS call: the mint key is a raw API key. The
     pass it returns is the one that travels as Bearer, on the socket. */
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, "Token KEY");
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { ttl_seconds: TOKEN_TTL_SECONDS });
});

test("a key that may transcribe but not mint is named, not lumped in with an outage", async () => {
  /*
   * Exactly what the original DEEPGRAM_API_KEY did at /v1/auth/grant on 24 Sep
   * 2026: a valid key, refused with "Insufficient permissions". The fix is a
   * permission rather than a retry, so the error has to say which it is.
   */
  const { impl } = stub(403, { err_code: "FORBIDDEN", err_msg: "Insufficient permissions." });
  await assert.rejects(mintVoiceToken("KEY", impl), (e: unknown) => {
    assert.ok(e instanceof TokenError);
    assert.equal(e.status, 503);
    assert.match(e.message, /not allowed to issue tokens/);
    return true;
  });
});

test("Deepgram unreachable is a 502, not a crash", async () => {
  const impl = (async () => {
    throw new TypeError("fetch failed");
  }) as unknown as typeof fetch;
  await assert.rejects(mintVoiceToken("KEY", impl), (e: unknown) => {
    assert.ok(e instanceof TokenError);
    assert.equal(e.status, 502);
    return true;
  });
});

test("an answer with no token in it is refused rather than passed on", async () => {
  /* A 200 carrying nothing would hand the browser `undefined` as its pass,
     and the socket would fail with an error that points nowhere near here. */
  const { impl } = stub(200, { something_else: true });
  await assert.rejects(mintVoiceToken("KEY", impl), TokenError);
});

test("a missing expiry falls back to the requested lifetime", async () => {
  const { impl } = stub(200, { access_token: "tok" });
  assert.equal((await mintVoiceToken("KEY", impl)).expiresIn, TOKEN_TTL_SECONDS);
});
