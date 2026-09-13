import { neon } from "@neondatabase/serverless";

/**
 * The database connection.
 *
 * Neon's HTTP driver rather than a TCP pool, because every caller here is a
 * serverless function: a pool that assumes a long-lived process either leaks
 * connections or spends the whole invocation opening one. Over HTTP each query
 * is a request, which is exactly the shape of the thing making it.
 *
 * SERVER ONLY. DATABASE_URL has no NEXT_PUBLIC_ prefix, so importing this from
 * a client component gets undefined and a confusing runtime error rather than
 * a leaked credential — but it is still a bug, and the fix is to call an API
 * route instead.
 */

let sql: ReturnType<typeof neon> | null = null;

export function db() {
  if (sql) return sql;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Rules cannot outlive the browser without it — see lib/db/schema.sql.",
    );
  }
  sql = neon(url);
  return sql;
}

/** True when a database is configured at all. */
export function hasDb(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

/**
 * Postgres numerics arrive as strings.
 *
 * The driver does this deliberately — numeric holds values JavaScript's number
 * cannot — and it is exactly the sort of thing that silently concatenates
 * instead of adding. Everything read out of a numeric column goes through here.
 */
export function num(v: unknown): number {
  return typeof v === "number" ? v : Number(v);
}
