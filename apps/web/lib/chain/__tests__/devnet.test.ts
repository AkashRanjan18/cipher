import { test } from "node:test";
import assert from "node:assert/strict";
import { createPublicKey, verify } from "node:crypto";
import {
  base58Decode,
  base58Encode,
  memoTransaction,
  signerFrom,
  MEMO_PROGRAM,
  MEMO_MAX_BYTES,
} from "../devnet.ts";

/* 32 bytes, 1..32. Not a key anyone holds: a fixed seed so the test is the
   same every run. */
const SEED = base58Encode(Uint8Array.from({ length: 32 }, (_, i) => i + 1));
const BLOCKHASH = base58Encode(Uint8Array.from({ length: 32 }, (_, i) => 200 - i));

test("base58 round-trips, leading zeros included", () => {
  for (const bytes of [
    Uint8Array.from([0, 0, 1, 2, 3]),
    Uint8Array.from([255, 255, 255]),
    Uint8Array.from({ length: 32 }, (_, i) => (i * 37) % 256),
    new Uint8Array(32),
  ]) {
    assert.deepEqual(base58Decode(base58Encode(bytes)), bytes);
  }
});

test("base58 agrees with known Solana addresses", () => {
  /* The system program is thirty-two zero bytes; the memo program is 32 bytes. */
  assert.equal(base58Encode(new Uint8Array(32)), "11111111111111111111111111111111");
  assert.equal(base58Decode(MEMO_PROGRAM).length, 32);
  assert.equal(base58Encode(base58Decode(MEMO_PROGRAM)), MEMO_PROGRAM);
  assert.throws(() => base58Decode("0OIl"));
});

test("a signer takes the 32-byte seed and the 64-byte keypair alike", () => {
  const a = signerFrom(SEED);
  const pair = base58Encode(Uint8Array.from([...base58Decode(SEED), ...a.publicKey]));
  assert.equal(signerFrom(pair).address, a.address);
  assert.equal(a.publicKey.length, 32);
  assert.throws(() => signerFrom(base58Encode(new Uint8Array(31))));
});

test("the memo transaction has the legacy layout, field by field", () => {
  const signer = signerFrom(SEED);
  const memo = "cipher:v1 fill=f1 paper=1";
  const tx = memoTransaction(signer, memo, BLOCKHASH);

  assert.equal(tx[0], 1, "one signature");
  const signature = tx.subarray(1, 65);
  const message = tx.subarray(65);

  assert.deepEqual([...message.subarray(0, 3)], [1, 0, 1], "header");
  assert.equal(message[3], 2, "two accounts");
  assert.deepEqual(message.subarray(4, 36), signer.publicKey, "payer first");
  assert.equal(base58Encode(message.subarray(36, 68)), MEMO_PROGRAM);
  assert.equal(base58Encode(message.subarray(68, 100)), BLOCKHASH);
  assert.equal(message[100], 1, "one instruction");
  assert.equal(message[101], 1, "the memo program is account 1");
  assert.deepEqual([...message.subarray(102, 104)], [1, 0], "the payer is its one account");
  assert.equal(message[104], memo.length);
  assert.equal(new TextDecoder().decode(message.subarray(105)), memo);

  /* The signature is over the message and verifies against the payer's key. */
  const key = createPublicKey({
    key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(signer.publicKey)]),
    format: "der",
    type: "spki",
  });
  assert.equal(verify(null, Buffer.from(message), key, Buffer.from(signature)), true);
});

test("a memo over 127 bytes gets a two-byte length", () => {
  const signer = signerFrom(SEED);
  const memo = "x".repeat(200);
  const message = memoTransaction(signer, memo, BLOCKHASH).subarray(65);
  /* 200 = 0b1_1001000: low seven bits with the continue bit, then 1. */
  assert.deepEqual([...message.subarray(104, 106)], [0xc8, 0x01]);
  assert.equal(message.length, 106 + 200);
});

test("a memo over the limit is refused, not truncated", () => {
  assert.throws(() => memoTransaction(signerFrom(SEED), "x".repeat(MEMO_MAX_BYTES + 1), BLOCKHASH));
});
