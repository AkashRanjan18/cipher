import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { database, type Harness } from "../../db/__tests__/harness.ts";
import { db } from "../../db/client.ts";
import { base58Encode, signerFrom } from "../devnet.ts";
import { attestPending, isReceipt, receiptMemo, type ReceiptFill } from "../receipts.ts";
import { toPublicTrade } from "../../social/profiles.ts";

const SIGNER = signerFrom(base58Encode(Uint8Array.from({ length: 32 }, (_, i) => i + 1)));
const SOL = "So11111111111111111111111111111111111111112";

const FILL: ReceiptFill = {
  id: "f1",
  ts: 1760000000,
  mint: SOL,
  side: "buy",
  qty: 3.5,
  price: 142.1,
  feeUsd: 2.49,
  hideAmounts: false,
};

test("a receipt prints the fill and a hash of exactly what it prints", () => {
  const memo = receiptMemo(FILL);
  const at = memo.lastIndexOf(" sha256=");
  const shown = memo.slice(0, at);
  assert.equal(
    shown,
    `cipher:v1 fill=f1 ts=1760000000 side=buy mint=${SOL} price=142.1 qty=3.5 fee=2.49 paper=1`,
  );
  assert.equal(memo.slice(at + 8), createHash("sha256").update(shown).digest("hex"));
});

test("a receipt always says the money is paper", () => {
  assert.match(receiptMemo(FILL), / paper=1 /);
  assert.match(receiptMemo({ ...FILL, hideAmounts: true }), / paper=1 /);
});

test("hidden amounts never reach the chain", () => {
  const memo = receiptMemo({ ...FILL, hideAmounts: true, qty: 987.654, feeUsd: 12.34 });
  assert.match(memo, /amounts=hidden/);
  assert.doesNotMatch(memo, /qty=|fee=/);
  assert.doesNotMatch(memo, /987\.654|12\.34/);
  /* And the hash is of the printed text only, so it cannot be searched for the size. */
  const other = receiptMemo({ ...FILL, hideAmounts: true, qty: 1, feeUsd: 1 });
  assert.equal(memo, other);
});

test("a tiny price is written out, not in exponent form", () => {
  const memo = receiptMemo({ ...FILL, price: 0.00000012 });
  assert.match(memo, /price=0\.00000012 /);
  assert.doesNotMatch(memo, /e-/);
});

test("a claim is not a receipt", () => {
  assert.equal(isReceipt("pending:1760000000000"), false);
  assert.equal(isReceipt(null), false);
  assert.equal(isReceipt(""), false);
  assert.equal(isReceipt("5h3k"), true);
});

/* ── against a real Postgres ─────────────────────────────────────────────── */

let h: Harness;
before(async () => {
  h = await database();
});
after(async () => {
  await h.close();
});
beforeEach(async () => {
  await h.reset();
  await db()`insert into users (id) values ('u1'), ('u2')`;
});

async function fill(id: string, user: string, ts: number): Promise<void> {
  await db()`
    insert into fills (id, user_id, ts, mint, side, qty, price, fee_usd, realised_usd, squawk, source)
    values (${id}, ${user}, ${ts}, ${SOL}, 'buy', 2, 100, 0.95, 0, 'buy $200 of sol', 'sana')
  `;
}
const sigOf = async (id: string) =>
  ((await db()`select receipt_sig from fills where id = ${id}`)[0].receipt_sig as string | null);

test("every unattested fill gets a receipt, once", async () => {
  await fill("a", "u1", 10);
  await fill("b", "u2", 20);
  const sent: string[] = [];
  const send = async (_s: unknown, memo: string) => {
    sent.push(memo);
    return `sig${sent.length}`;
  };

  assert.equal(await attestPending({ signer: SIGNER, send }), 2);
  assert.match(sent[0], /fill=b /, "newest first");
  assert.equal(await sigOf("a"), "sig2");
  assert.equal(await sigOf("b"), "sig1");

  assert.equal(await attestPending({ signer: SIGNER, send }), 0, "nothing left to do");
  assert.equal(sent.length, 2);
});

test("scoped to one user, it leaves everyone else's for the worker", async () => {
  await fill("a", "u1", 10);
  await fill("b", "u2", 20);
  const send = async () => "sig";
  assert.equal(await attestPending({ signer: SIGNER, send, userId: "u1" }), 1);
  assert.equal(await sigOf("a"), "sig");
  assert.equal(await sigOf("b"), null);
});

test("a failed send releases the claim and is retried", async () => {
  await fill("a", "u1", 10);
  const down = async (): Promise<string> => {
    throw new Error("devnet is down");
  };
  assert.equal(await attestPending({ signer: SIGNER, send: down }), 0);
  assert.equal(await sigOf("a"), null);
  assert.equal(await attestPending({ signer: SIGNER, send: async () => "sig" }), 1);
  assert.equal(await sigOf("a"), "sig");
});

test("a live claim is left alone; an abandoned one is taken over", async () => {
  await fill("a", "u1", 10);
  const now = 1_760_000_000_000;
  await db()`update fills set receipt_sig = ${"pending:" + (now - 60_000)} where id = 'a'`;
  const send = async () => "sig";
  assert.equal(await attestPending({ signer: SIGNER, send, now }), 0, "claimed a minute ago");
  assert.equal(await attestPending({ signer: SIGNER, send, now: now + 10 * 60_000 }), 1, "ten minutes on");
  assert.equal(await sigOf("a"), "sig");
});

test("the trader's hide-amounts switch decides what the receipt says", async () => {
  await fill("a", "u1", 10);
  await db()`insert into profiles (user_id, handle, referral_code, hide_amounts) values ('u1', 'quiet', 'abc2345', true)`;
  let memo = "";
  await attestPending({
    signer: SIGNER,
    send: async (_s, m) => {
      memo = m;
      return "sig";
    },
  });
  assert.match(memo, /amounts=hidden/);
  assert.doesNotMatch(memo, /qty=/);
});

test("no key configured: nothing is claimed and nothing is sent", async () => {
  await fill("a", "u1", 10);
  assert.equal(await attestPending({ signer: null }), 0);
  assert.equal(await sigOf("a"), null);
});

test("a public trade carries its receipt, and never a claim", () => {
  const row = {
    id: "a", ts: 10, mint: SOL, side: "buy", qty: "2", price: "100", fee_usd: "0.95",
    realised_usd: "0", squawk: "buy $200 of sol", source: "sana", handle: "h", display_name: null,
    hide_amounts: false,
  };
  assert.equal(toPublicTrade({ ...row, receipt_sig: "5h3k" }).receipt, "5h3k");
  assert.equal(toPublicTrade({ ...row, receipt_sig: "pending:1" }).receipt, null);
  assert.equal(toPublicTrade({ ...row, receipt_sig: null }).receipt, null);
});
