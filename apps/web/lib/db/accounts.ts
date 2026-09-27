import { openAccount, type Account, type Fill, type Position } from "../account/paper.ts";
import { db, num } from "./client.ts";
import { OPENING_DEPOSIT } from "@cipher/shared";

/* Re-exported so existing importers keep working; defined in shared because
   this file and the client store each used to carry their own copy. */
export { OPENING_DEPOSIT };

/**
 * The paper ledger, server-side.
 *
 * Same Account shape and the same paper.ts arithmetic — this file only moves
 * rows. Duplicating the money math for the server would be how the two halves
 * start disagreeing, and a user watching one number in the browser while a
 * worker computes another is the worst possible bug in a trading app.
 *
 * POSITIONS ARE THEIR OWN TABLE now, one row per market held. They were two
 * columns on `accounts` — `sol` and `cost_basis` — which is the reason cipher
 * could list the whole chain and trade one coin. A row exists only while
 * something is held; going flat deletes it.
 */

type Row = Record<string, unknown>;

function toAccount(r: Row, positions: Record<string, Position>, fills: Fill[]): Account {
  return {
    usdc: num(r.usdc),
    positions,
    realisedUsd: num(r.realised_usd),
    feesUsd: num(r.fees_usd),
    depositedUsd: num(r.deposited_usd),
    fills,
  };
}

export async function ensureUser(userId: string): Promise<void> {
  const sql = db();
  await sql`insert into users (id) values (${userId}) on conflict (id) do nothing`;
  const opening = openAccount(OPENING_DEPOSIT);
  await sql`
    insert into accounts (user_id, usdc, realised_usd, fees_usd, deposited_usd)
    values (${userId}, ${opening.usdc}, ${opening.realisedUsd},
            ${opening.feesUsd}, ${opening.depositedUsd})
    on conflict (user_id) do nothing
  `;
}

export async function loadAccount(userId: string, withFills = true): Promise<Account | null> {
  const rows = (await db()`select * from accounts where user_id = ${userId}`) as Row[];
  if (!rows[0]) return null;
  const positions = await loadPositions(userId);
  const fills = withFills ? await loadFills(userId) : [];
  return toAccount(rows[0], positions, fills);
}

/**
 * Everything held, keyed by mint.
 *
 * Loaded even when fills are skipped — the worker passes `withFills: false` to
 * save a query, but it CANNOT skip positions: they are what it is about to
 * sell. A worker holding an account with no positions would read every market
 * as flat and cancel every stop as moot.
 */
export async function loadPositions(userId: string): Promise<Record<string, Position>> {
  const rows = (await db()`
    select mint, qty, cost_basis from positions where user_id = ${userId}
  `) as Row[];
  const out: Record<string, Position> = {};
  for (const r of rows) {
    out[String(r.mint)] = { qty: num(r.qty), costBasis: num(r.cost_basis) };
  }
  return out;
}

export async function loadFills(userId: string, limit = 200): Promise<Fill[]> {
  const rows = (await db()`
    select * from fills where user_id = ${userId} order by ts desc, id desc limit ${limit}
  `) as Row[];
  return rows.reverse().map((r) => ({
    id: String(r.id),
    ts: num(r.ts),
    mint: String(r.mint),
    side: r.side as "buy" | "sell",
    qty: num(r.qty),
    price: num(r.price),
    feeUsd: num(r.fee_usd),
    realisedUsd: num(r.realised_usd),
    squawk: String(r.squawk ?? ""),
    source: r.source as Fill["source"],
  }));
}

/**
 * Write the account, the position it moved, and the fill that explains it.
 *
 * cipher: three statements, not one transaction. Neon's HTTP driver runs each
 * query on its own connection, so a crash between them leaves a balance that
 * moved without a fill to explain it. ORDER MATTERS and it is chosen: cash
 * first, then the position, then the fill. A missing fill row is a gap in the
 * history; a missing cash update would let the same rule fire again against
 * money it already spent, and a position written before the cash would show
 * someone a holding they had not paid for. The fix is `transaction()` from the
 * pooled driver when this stops being a paper ledger; it is a real edge and it
 * is worth naming rather than pretending.
 */
/**
 * Write a fill and the account it produced. Returns false, writing NOTHING,
 * when `expectedUsdc` is given and the balance is no longer that.
 *
 * THE LOST UPDATE. Every writer here loads the account, computes the next one
 * in paper.ts, and writes ABSOLUTE values back. Two writers for one user at
 * the same moment — a double-clicked Buy, or a stop firing in the worker while
 * the user trades — both start from the same balance, and the second write
 * erases the first: one trade's cost vanishes, and a trade is free.
 *
 * The HTTP driver cannot hold a row lock across a read and a write, so this is
 * a compare-and-set on the balance instead. It is a sound version number
 * because every fill moves it: a buy spends, a sell pays out, and the fee
 * makes a zero-change fill impossible. The update only lands if the balance is
 * still the one the trade was priced against; if not, the caller re-reads and
 * decides again with the truth.
 *
 * cipher: the balance round-trips through a JS number, which is exact while it
 * stays under about $10M at 8 decimals. Past that, a `version` column is the
 * upgrade, and it needs a migration on Neon.
 */
export async function saveFill(
  userId: string,
  account: Account,
  fill: Fill,
  expectedUsdc?: number,
): Promise<boolean> {
  /*
   * ONE STATEMENT, so it is one transaction. The balance, the position and the
   * fill used to be three separate writes, and the review of 27 Sep 2026 found
   * the gap between them: a reader could see the new balance and the OLD
   * position, pass the balance check with it, and write back a quantity that
   * erased the other trade's tokens. Data-modifying CTEs all run in the same
   * snapshot and commit together, and everything after `moved` only happens
   * if the balance check passed.
   *
   * Every parameter is cast, because an INSERT ... SELECT does not infer its
   * parameter types from the target columns the way INSERT ... VALUES does.
   */
  const sql = db();
  const expected = expectedUsdc ?? null;
  const held = account.positions[fill.mint];
  const rows = held
    ? await sql`
        with moved as (
          update accounts set
            usdc = ${account.usdc}::numeric,
            realised_usd = ${account.realisedUsd}::numeric,
            fees_usd = ${account.feesUsd}::numeric,
            updated_at = now()
          where user_id = ${userId}
            and (${expected}::numeric is null or usdc = ${expected}::numeric)
          returning user_id
        ),
        pos as (
          insert into positions (user_id, mint, qty, cost_basis)
          select user_id, ${fill.mint}::text, ${held.qty}::numeric, ${held.costBasis}::numeric from moved
          on conflict (user_id, mint) do update set
            qty = excluded.qty,
            cost_basis = excluded.cost_basis,
            updated_at = now()
        ),
        f as (
          insert into fills (id, user_id, ts, mint, side, qty, price, fee_usd, realised_usd, squawk, source)
          select ${fill.id}::text, user_id, ${fill.ts}::bigint, ${fill.mint}::text, ${fill.side}::text,
                 ${fill.qty}::numeric, ${fill.price}::numeric, ${fill.feeUsd}::numeric,
                 ${fill.realisedUsd}::numeric, ${fill.squawk}::text, ${fill.source}::text
          from moved
          on conflict (id) do nothing
        )
        select count(*)::int as n from moved
      `
    : await sql`
        with moved as (
          update accounts set
            usdc = ${account.usdc}::numeric,
            realised_usd = ${account.realisedUsd}::numeric,
            fees_usd = ${account.feesUsd}::numeric,
            updated_at = now()
          where user_id = ${userId}
            and (${expected}::numeric is null or usdc = ${expected}::numeric)
          returning user_id
        ),
        /* Flat deletes the row. A zero row would mean every read has to filter
           for it, forever, on every coin the user ever touched. */
        pos as (
          delete from positions
          where user_id = ${userId} and mint = ${fill.mint} and exists (select 1 from moved)
        ),
        f as (
          insert into fills (id, user_id, ts, mint, side, qty, price, fee_usd, realised_usd, squawk, source)
          select ${fill.id}::text, user_id, ${fill.ts}::bigint, ${fill.mint}::text, ${fill.side}::text,
                 ${fill.qty}::numeric, ${fill.price}::numeric, ${fill.feeUsd}::numeric,
                 ${fill.realisedUsd}::numeric, ${fill.squawk}::text, ${fill.source}::text
          from moved
          on conflict (id) do nothing
        )
        select count(*)::int as n from moved
      `;
  return num(rows[0]?.n) > 0;
}

/**
 * Did this fill land? For the one case where the answer is unknown: the
 * database committed saveFill and the reply was lost on the way back.
 * Retrying without asking would book the same trade twice.
 */
export async function fillExists(id: string): Promise<boolean> {
  const rows = await db()`select 1 from fills where id = ${id}`;
  return rows.length > 0;
}

export async function resetAccount(userId: string): Promise<void> {
  const sql = db();
  const opening = openAccount(OPENING_DEPOSIT);
  /*
   * `deposited_usd` TOO, and leaving it out was a real bug hiding behind a
   * coincidence. Reset restored the cash to the opening balance and left the
   * deposit basis at whatever it had been, which agreed only because the two
   * numbers were both $10,000. The moment the opening balance changed they
   * disagreed, and the header read "BAG $0 −100.00%" on a freshly reset
   * account: cash of nothing measured against a deposit of ten thousand.
   *
   * Reset means the account is as it was on the first day. The basis every
   * return is measured from is part of that.
   */
  /* One statement, one transaction: a stop firing between "cash reset" and
     "positions deleted" would otherwise sell a position that was about to
     stop existing, into an account that had just been zeroed.
     Rules in 'firing' are cancelled too: one the worker claimed mid-reset
     would otherwise lose its balance check, go back to armed, and trade the
     pre-reset order into the freshly reset account on the next tick. */
  await sql`
    with acct as (
      update accounts set
        usdc = ${opening.usdc}::numeric,
        realised_usd = ${opening.realisedUsd}::numeric,
        fees_usd = ${opening.feesUsd}::numeric,
        deposited_usd = ${opening.depositedUsd}::numeric,
        updated_at = now()
      where user_id = ${userId}
    ),
    pos as (delete from positions where user_id = ${userId}),
    f as (delete from fills where user_id = ${userId})
    update rules set state = 'cancelled'
    where user_id = ${userId} and state in ('unbound', 'armed', 'firing')
  `;
}
