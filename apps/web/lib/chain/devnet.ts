import { createPrivateKey, createPublicKey, sign as edSign, type KeyObject } from "node:crypto";

/**
 * Solana devnet, spoken by hand: one signer, one Memo instruction, one RPC.
 *
 * WHY THIS IS NOT @solana/web3.js. cipher's first on-chain write is a receipt:
 * a line of text in a Memo transaction, signed by cipher's own devnet key. That
 * is a 150-byte message with a fixed layout, and the SDK that builds it is
 * several megabytes on a serverless cold start. The layout is written out
 * below instead; the suite checks it field by field and verifies the
 * signature, and devnet itself is the last test — it rejects a wrong byte.
 *
 * DEVNET ONLY, and the money stays paper. Nothing here moves a token. The
 * swap leg (relayer, delegate authority) is phase 1 and has no devnet to run
 * on: Jupiter's routes are mainnet liquidity. What CAN be real today is the
 * record — see lib/chain/receipts.ts for what is written and why.
 *
 * Server only: it reads CIPHER_DEVNET_KEY, which has no NEXT_PUBLIC_ prefix.
 */

export const DEVNET_RPC = "https://api.devnet.solana.com";
/** SPL Memo v2. The same address on every cluster. */
export const MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

/* A memo is validated as UTF-8 on chain and that costs compute by the byte.
   566 bytes is the documented ceiling inside the default budget; staying well
   under it means a receipt never needs a compute-budget instruction. */
export const MEMO_MAX_BYTES = 400;

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/* Long division by hand in both directions, a byte at a time. BigInt would be
   shorter, but tsconfig targets below ES2020 and has no BigInt literals. */

export function base58Encode(bytes: Uint8Array): string {
  const digits: number[] = [];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let out = "";
  /* Leading zero bytes carry no value, so each is written as a literal "1". */
  for (const b of bytes) {
    if (b !== 0) break;
    out += "1";
  }
  for (let i = digits.length - 1; i >= 0; i--) out += B58[digits[i]];
  return out;
}

export function base58Decode(text: string): Uint8Array {
  const bytes: number[] = [];
  for (const ch of text) {
    let carry = B58.indexOf(ch);
    if (carry < 0) throw new Error("not base58");
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const ch of text) {
    if (ch !== "1") break;
    bytes.push(0);
  }
  return Uint8Array.from(bytes.reverse());
}

export interface Signer {
  /** The address, base58. */
  address: string;
  publicKey: Uint8Array;
  sign(message: Uint8Array): Uint8Array;
}

/* The fixed PKCS#8 wrapper for a raw 32-byte Ed25519 seed (RFC 8410). Node
   will not take a bare seed, and this prefix is the whole of the difference. */
const PKCS8_ED25519 = Buffer.from("302e020100300506032b657004220420", "hex");

/**
 * A signer from a secret, in either shape Solana tooling writes one: the
 * 32-byte seed, or the 64-byte seed-plus-public-key of `solana-keygen`.
 * Base58 in both cases.
 */
export function signerFrom(secret: string): Signer {
  const raw = base58Decode(secret.trim());
  if (raw.length !== 32 && raw.length !== 64) throw new Error("a Solana key is 32 or 64 bytes");
  const key: KeyObject = createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519, Buffer.from(raw.subarray(0, 32))]),
    format: "der",
    type: "pkcs8",
  });
  /* The last 32 bytes of the SPKI encoding are the public key itself. */
  const spki = createPublicKey(key).export({ format: "der", type: "spki" });
  const publicKey = Uint8Array.from(spki.subarray(spki.length - 32));
  return {
    address: base58Encode(publicKey),
    publicKey,
    sign: (message) => Uint8Array.from(edSign(null, Buffer.from(message), key)),
  };
}

/** Solana's compact-u16: seven bits a byte, low bits first. */
function shortVec(n: number): number[] {
  const out: number[] = [];
  for (;;) {
    const low = n & 0x7f;
    n >>= 7;
    if (n === 0) {
      out.push(low);
      return out;
    }
    out.push(low | 0x80);
  }
}

/**
 * A signed, serialised Memo transaction (legacy format).
 *
 *   signatures   [1, sig]
 *   header       1 required signature, 0 read-only signed, 1 read-only unsigned
 *   accounts     [payer, memo program]
 *   blockhash    32 bytes
 *   instruction  program index 1, the payer as its one account, the memo bytes
 *
 * THE PAYER IS PASSED TO THE MEMO PROGRAM, not just made to pay. The program
 * checks that every account it is handed signed the transaction, so the memo
 * is provably cipher's — a memo with no accounts is text anyone could have
 * written.
 */
export function memoTransaction(signer: Signer, memo: string, blockhash: string): Uint8Array {
  const data = new TextEncoder().encode(memo);
  if (data.length > MEMO_MAX_BYTES) throw new Error(`a memo is at most ${MEMO_MAX_BYTES} bytes`);
  const message = Uint8Array.from([
    1, 0, 1,
    ...shortVec(2),
    ...signer.publicKey,
    ...base58Decode(MEMO_PROGRAM),
    ...base58Decode(blockhash),
    ...shortVec(1),
    1,
    ...shortVec(1),
    0,
    ...shortVec(data.length),
    ...data,
  ]);
  return Uint8Array.from([...shortVec(1), ...signer.sign(message), ...message]);
}

async function rpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    /* A receipt is written after the trade, never in its way. Five seconds and
       it is left for the next tick. */
    signal: AbortSignal.timeout(5000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`devnet rpc ${method}: http ${res.status}`);
  const body = (await res.json()) as { result?: T; error?: { message?: string } };
  if (body.error || body.result === undefined) {
    throw new Error(`devnet rpc ${method}: ${body.error?.message ?? "no result"}`);
  }
  return body.result;
}

/** The devnet key, or null when receipts are not configured. */
export function devnetSigner(): Signer | null {
  const secret = process.env.CIPHER_DEVNET_KEY;
  if (!secret) return null;
  try {
    return signerFrom(secret);
  } catch (e) {
    console.error("[cipher] CIPHER_DEVNET_KEY is not a usable key:", e);
    return null;
  }
}

export function devnetRpcUrl(): string {
  return process.env.SOLANA_DEVNET_RPC || DEVNET_RPC;
}

/**
 * Write one memo to devnet and return the transaction signature.
 *
 * Resolves once the RPC has ACCEPTED the transaction (it simulates it first),
 * not once it is finalised: a serverless function should not sit and poll.
 * The signature is the receipt either way — Explorer shows the status.
 */
export async function sendMemo(signer: Signer, memo: string, url = devnetRpcUrl()): Promise<string> {
  const latest = await rpc<{ value: { blockhash: string } }>(url, "getLatestBlockhash", [
    { commitment: "confirmed" },
  ]);
  const tx = memoTransaction(signer, memo, latest.value.blockhash);
  return rpc<string>(url, "sendTransaction", [
    Buffer.from(tx).toString("base64"),
    { encoding: "base64", preflightCommitment: "confirmed" },
  ]);
}
