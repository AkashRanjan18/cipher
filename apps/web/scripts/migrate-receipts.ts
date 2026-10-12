import { existsSync, readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

/**
 * Add `fills.receipt_sig` to a database that already exists.
 *
 *   node --experimental-strip-types scripts/migrate-receipts.ts          (from apps/web)
 *
 * The same two statements are in lib/db/schema.sql, which is what a NEW
 * database runs. This is for the live one: additive, nullable, `if not
 * exists`, safe to run twice and safe to run while the old code is serving.
 */

function databaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (existsSync(".env.local")) {
    const line = readFileSync(".env.local", "utf8")
      .split(/\r?\n/)
      .find((l) => l.startsWith("DATABASE_URL="));
    const value = line?.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "");
    if (value) return value;
  }
  throw new Error("DATABASE_URL is not set");
}

const sql = neon(databaseUrl());
await sql`alter table fills add column if not exists receipt_sig text`;
await sql`create index if not exists fills_unattested on fills (ts desc) where receipt_sig is null`;
const [row] = await sql`
  select count(*)::int as fills, count(receipt_sig)::int as attested from fills
`;
console.log(`fills.receipt_sig is in place. ${row.fills} fills, ${row.attested} with a receipt.`);
