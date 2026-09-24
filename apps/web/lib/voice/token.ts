/**
 * A sixty-second pass that lets a browser talk to Deepgram directly.
 *
 * WHY THE BROWSER TALKS TO DEEPGRAM AT ALL. Streaming is the only way to make
 * voice feel instant — the audio is transcribed WHILE somebody speaks, so when
 * they let go of Ctrl almost nothing is left to do. That needs a socket held
 * open for the whole sentence, and cipher runs on Vercel, whose functions
 * answer one request and end: they cannot hold one. So the browser opens the
 * socket to Deepgram itself, and nothing sits in between.
 *
 * WHY NOT THE REAL KEY. Anything a browser holds, its user holds — the key
 * would be sitting in the Network tab in plain text, and a leaked speech key
 * is found by a crawler and drained within hours. So the server keeps the key
 * and hands out a pass that dies in sixty seconds and can only transcribe.
 *
 * WHY A SECOND KEY. Creating a credential is an admin power in Deepgram and
 * transcribing is not, so the key that transcribes (DEEPGRAM_API_KEY) cannot
 * mint and this one (DEEPGRAM_MINT_KEY) never transcribes. Neither can become
 * the other if it leaks. Verified against the live API, 24 Sep 2026: the
 * transcribing key is refused at /v1/auth/grant with "Insufficient
 * permissions"; the minting key issues a token on the first call.
 *
 * In lib/ rather than in the route, because a route cannot be imported by the
 * test runner and anything living in one is code with no test behind it.
 */

const GRANT = "https://api.deepgram.com/v1/auth/grant";

/**
 * Sixty seconds — the longest sentence plus the handshake, with room.
 *
 * Long enough that a token minted when the page loads is still valid when
 * somebody finally presses Ctrl, short enough that one lifted out of the
 * Network tab is worth a minute of transcription and nothing more.
 */
export const TOKEN_TTL_SECONDS = 60;

export interface VoiceToken {
  token: string;
  /** Seconds until Deepgram refuses it. */
  expiresIn: number;
}

export class TokenError extends Error {
  /* Declared and assigned rather than a `readonly status` parameter property:
     the test runner strips types without compiling them, and a parameter
     property is syntax it refuses outright. */
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function mintVoiceToken(
  key: string,
  fetchImpl: typeof fetch = fetch,
): Promise<VoiceToken> {
  let res: Response;
  try {
    res = await fetchImpl(GRANT, {
      method: "POST",
      headers: { Authorization: `Token ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ttl_seconds: TOKEN_TTL_SECONDS }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw new TokenError("Deepgram could not be reached to issue a voice token.", 502);
  }

  /* A 403 here means the key is valid but may not mint — the exact failure the
     transcribing key produced — and it is worth naming rather than lumping in
     with an outage, because the fix is a permission, not a retry. */
  if (res.status === 401 || res.status === 403) {
    throw new TokenError("The voice key is not allowed to issue tokens.", 503);
  }
  if (!res.ok) throw new TokenError("Deepgram refused to issue a voice token.", 502);

  const body = (await res.json().catch(() => ({}))) as { access_token?: unknown; expires_in?: unknown };
  if (typeof body.access_token !== "string" || !body.access_token) {
    throw new TokenError("Deepgram answered without a token.", 502);
  }
  return {
    token: body.access_token,
    expiresIn: typeof body.expires_in === "number" ? body.expires_in : TOKEN_TTL_SECONDS,
  };
}
