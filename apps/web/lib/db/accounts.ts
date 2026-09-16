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
export async function saveFill(userId: string, account: Account, fill: Fill): Promise<void> {
  const sql = db();
  await sql`
    update accounts set
      usdc = ${account.usdc},
      realised_usd = ${account.realisedUsd},
      fees_usd = ${account.feesUsd},
      updated_at = now()
    where user_id = ${userId}
  `;

  const held = account.positions[fill.mint];
  if (held) {
    await sql`
      insert into positions (user_id, mint, qty, cost_basis)
      values (${userId}, ${fill.mint}, ${held.qty}, ${held.costBasis})
      on conflict (user_id, mint) do update set
        qty = excluded.qty,
        cost_basis = excluded.cost_basis,
        updated_at = now()
    `;
  } else {
    /* Flat deletes the row. A zero row would mean every read has to filter
       for it, forever, on every coin the user ever touched. */
    await sql`delete from positions where user_id = ${userId} and mint = ${fill.mint}`;
  }

  await sql`
    insert into fills (id, user_id, ts, mint, side, qty, price, fee_usd, realised_usd, squawk, source)
    values (${fill.id}, ${userId}, ${fill.ts}, ${fill.mint}, ${fill.side}, ${fill.qty},
            ${fill.price}, ${fill.feeUsd}, ${fill.realisedUsd}, ${fill.squawk}, ${fill.source})
    on conflict (id) do nothing
  `;
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
  await sql`
    update accounts set
      usdc = ${opening.usdc},
      realised_usd = ${opening.realisedUsd},
      fees_usd = ${opening.feesUsd},
      deposited_usd = ${opening.depositedUsd},
      updated_at = now()
    where user_id = ${userId}
  `;
  await sql`delete from positions where user_id = ${userId}`;
  await sql`delete from fills where user_id = ${userId}`;
  await sql`update rules set state = 'cancelled' where user_id = ${userId} and state in ('unbound', 'armed')`;
}
