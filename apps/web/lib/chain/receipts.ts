import { createHash } from "node:crypto";
import { db, num } from "../db/client.ts";
import { devnetSigner, sendMemo, MEMO_MAX_BYTES, type Signer } from "./devnet.ts";

/**
 * On-chain receipts: every fill, written to Solana devnet.
 *
 * WHAT THIS IS FOR. cipher's promise is that you can always see what happened
 * to your money: what you got, at what price, and what cipher took. Until now
 * the only evidence was cipher's own database, which cipher could edit. A
 * receipt is the same record signed by cipher's key and written where cipher
 * cannot change it afterwards — anyone can open it in Solana Explorer and
 * compare it with what the app shows.
 *
 * WHAT THIS IS NOT. It is not a swap. The money is still paper; the fill was
 * priced against a real Jupiter quote and booked in Postgres. The receipt
 * says `paper=1` in so many words, on chain, so nobody reading Explorer can
 * take it for a trade that moved tokens.
 *
 * AFTER THE TRADE, NEVER IN ITS WAY. A fill is booked first and attested
 * later, by this file, from two places: right after a person's trade
 * (app/api/trade/route.ts) and at the end of every worker tick
 * (app/api/tick/route.ts), which also drains anything the first missed. If
 * devnet is down, trades do not notice.
 */

export interface ReceiptFill {
  id: string;
  ts: number;
  mint: string;
  side: "buy" | "sell";
  qty: number;
  price: number;
  feeUsd: number;
  /** The trader hides amounts: the receipt must not publish them either. */
  hideAmounts: boolean;
}

/**
 * The line that goes on chain.
 *
 *   cipher:v1 fill=<id> ts=<unix> side=buy mint=<mint> price=<usd per token>
 *   qty=<tokens> fee=<usd> paper=1 sha256=<hash of everything before it>
 *
 * Plain `key=value` rather than JSON so it reads in Explorer without a tool.
 *
 * HIDE-AMOUNTS IS HONOURED HERE TOO. A chain is public for ever; a trader who
 * hides their size in the app must not find it in a memo. Their receipt
 * carries the coin, the side and the price — what their profile already shows
 * — and says `amounts=hidden`. The hash covers only what is printed, so it
 * cannot be used to guess the size either.
 */
export function receiptMemo(f: ReceiptFill): string {
  const shown = [
    "cipher:v1",
    `fill=${f.id}`,
    `ts=${f.ts}`,
    `side=${f.side}`,
    `mint=${f.mint}`,
    `price=${plain(f.price)}`,
    ...(f.hideAmounts ? ["amounts=hidden"] : [`qty=${plain(f.qty)}`, `fee=${plain(f.feeUsd)}`]),
    "paper=1",
  ].join(" ");
  const memo = `${shown} sha256=${createHash("sha256").update(shown).digest("hex")}`;
  if (new TextEncoder().encode(memo).length > MEMO_MAX_BYTES) throw new Error("receipt too long");
  return memo;
}

/** A number without exponent notation: 1e-7 is not something to read a price from. */
function plain(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const s = String(n);
  return /e/i.test(s) ? n.toFixed(18).replace(/0+$/, "").replace(/\.$/, "") : s;
}

/* A claim older than this was abandoned by a function that died mid-send. */
const STALE_CLAIM_MS = 5 * 60_000;
const CLAIM = "pending:";

/** True when `receipt_sig` holds a real signature rather than a claim. */
export function isReceipt(sig: unknown): sig is string {
  return typeof sig === "string" && sig.length > 0 && !sig.startsWith(CLAIM);
}

type Row = Record<string, unknown>;

/**
 * Write receipts for fills that do not have one. Returns how many were sent.
 *
 * CLAIM, SEND, RECORD. Two functions can run this in the same second — a
 * trade's own follow-up and the worker's tick — so a fill is claimed first, in
 * one statement, by writing `pending:<time>` where the signature will go. Only
 * the function whose update returned the row sends its receipt. A failed send
 * releases the claim; a function that dies holding one is covered by the
 * stale-claim rule above.
 *
 * cipher: a crash between the send and the write that records it re-sends the
 * same receipt five minutes later — two identical memos on chain for one
 * fill. Harmless (same text, same hash) and named rather than hidden. The
 * upgrade is to derive the claim's blockhash so the retry is the same
 * transaction, when receipts guard something that can be double-spent.
 *
 * NEVER THROWS. Its callers are a trade that has already succeeded and the
 * worker that fires stops; neither may fail because devnet did.
 */
export async function attestPending(
  opts: { userId?: string; limit?: number; now?: number; signer?: Signer | null; send?: typeof sendMemo } = {},
): Promise<number> {
  const signer = opts.signer === undefined ? devnetSigner() : opts.signer;
  if (!signer) return 0;
  const send = opts.send ?? sendMemo;
  const now = opts.now ?? Date.now();
  const limit = opts.limit ?? 6;
  const userId = opts.userId ?? null;
  const stale = now - STALE_CLAIM_MS;
  const claim = `${CLAIM}${now}`;

  let sent = 0;
  try {
    const rows = (await db()`
      with todo as (
        select f.id from fills f
        where (${userId}::text is null or f.user_id = ${userId}::text)
          and (f.receipt_sig is null
               or (f.receipt_sig like 'pending:%' and substring(f.receipt_sig from 9)::bigint < ${stale}::bigint))
        order by f.ts desc, f.id desc
        limit ${limit}::int
      )
      update fills f set receipt_sig = ${claim}::text
      from todo
      where f.id = todo.id
      returning f.id, f.ts, f.mint, f.side, f.qty, f.price, f.fee_usd,
        /* No profile row yet means the default, which is public. */
        coalesce((select p.hide_amounts from profiles p where p.user_id = f.user_id), false) as hide_amounts
    `) as Row[];

    for (const r of rows) {
      const id = String(r.id);
      try {
        const sig = await send(
          signer,
          receiptMemo({
            id,
            ts: num(r.ts),
            mint: String(r.mint),
            side: r.side === "sell" ? "sell" : "buy",
            qty: num(r.qty),
            price: num(r.price),
            feeUsd: num(r.fee_usd),
            hideAmounts: Boolean(r.hide_amounts),
          }),
        );
        await db()`update fills set receipt_sig = ${sig} where id = ${id} and receipt_sig = ${claim}`;
        sent++;
      } catch (e) {
        console.error("[cipher] receipt not written for", id, e);
        await db()`update fills set receipt_sig = null where id = ${id} and receipt_sig = ${claim}`;
      }
    }
  } catch (e) {
    console.error("[cipher] attestPending failed:", e);
  }
  return sent;
}
