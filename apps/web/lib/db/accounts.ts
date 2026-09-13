import { openAccount, type Account, type Fill } from "../account/paper.ts";
import { db, num } from "./client.ts";

/** The opening balance, mirrored from the client store. */
export const OPENING_DEPOSIT = 10_000;

/**
 * The paper ledger, server-side.
 *
 * Same Account shape and the same paper.ts arithmetic — this file only moves
 * rows. Duplicating the money math for the server would be how the two halves
 * start disagreeing, and a user watching one number in the browser while a
 * worker computes another is the worst possible bug in a trading app.
 */

type Row = Record<string, unknown>;

function toAccount(r: Row, fills: Fill[]): Account {
  return {
    usdc: num(r.usdc),
    sol: num(r.sol),
    costBasis: num(r.cost_basis),
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
    insert into accounts (user_id, usdc, sol, cost_basis, realised_usd, fees_usd, deposited_usd)
    values (${userId}, ${opening.usdc}, ${opening.sol}, ${opening.costBasis},
            ${opening.realisedUsd}, ${opening.feesUsd}, ${opening.depositedUsd})
    on conflict (user_id) do nothing
  `;
}

export async function loadAccount(userId: string, withFills = true): Promise<Account | null> {
  const rows = (await db()`select * from accounts where user_id = ${userId}`) as Row[];
  if (!rows[0]) return null;
  const fills = withFills ? await loadFills(userId) : [];
  return toAccount(rows[0], fills);
}

export async function loadFills(userId: string, limit = 200): Promise<Fill[]> {
  const rows = (await db()`
    select * from fills where user_id = ${userId} order by ts desc limit ${limit}
  `) as Row[];
  return rows.reverse().map((r) => ({
    id: String(r.id),
    ts: num(r.ts),
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
 * Write the account and the fill it produced, together.
 *
 * cipher: two statements, not one transaction. Neon's HTTP driver runs each
 * query on its own connection, so a crash between them leaves a balance that
 * moved without a fill to explain it. The balance is written FIRST on purpose
 * — a missing fill row is a gap in the history, while a missing balance update
 * would let the same rule fire again against money it already spent. The fix
 * is `transaction()` from the pooled driver when this stops being a paper
 * ledger; it is a real edge and it is worth naming rather than pretending.
 */
export async function saveFill(userId: string, account: Account, fill: Fill): Promise<void> {
  const sql = db();
  await sql`
    update accounts set
      usdc = ${account.usdc},
      sol = ${account.sol},
      cost_basis = ${account.costBasis},
      realised_usd = ${account.realisedUsd},
      fees_usd = ${account.feesUsd},
      updated_at = now()
    where user_id = ${userId}
  `;
  await sql`
    insert into fills (id, user_id, ts, side, qty, price, fee_usd, realised_usd, squawk, source)
    values (${fill.id}, ${userId}, ${fill.ts}, ${fill.side}, ${fill.qty}, ${fill.price},
            ${fill.feeUsd}, ${fill.realisedUsd}, ${fill.squawk}, ${fill.source})
    on conflict (id) do nothing
  `;
}

export async function resetAccount(userId: string): Promise<void> {
  const sql = db();
  const opening = openAccount(OPENING_DEPOSIT);
  await sql`
    update accounts set
      usdc = ${opening.usdc}, sol = ${opening.sol}, cost_basis = ${opening.costBasis},
      realised_usd = ${opening.realisedUsd}, fees_usd = ${opening.feesUsd},
      updated_at = now()
    where user_id = ${userId}
  `;
  await sql`delete from fills where user_id = ${userId}`;
  await sql`update rules set state = 'cancelled' where user_id = ${userId} and state in ('unbound', 'armed')`;
}
