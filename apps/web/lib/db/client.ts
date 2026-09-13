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

/**
 * Anything that runs a query as a tagged template and hands back rows.
 *
 * Neon's `sql` already has this shape. Naming it is what lets a test put a
 * different Postgres behind the whole data layer — see `useDriver`.
 */
export type Driver = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<Record<string, unknown>[]>;

let sql: Driver | null = null;

/**
 * Point every query in this folder at another Postgres. TESTS ONLY.
 *
 * NOT a convenience. Until this existed, `schema.sql` and the forty-odd
 * queries around it had never executed — the only way to run them was to own a
 * Neon account, so the most dangerous code in cipher was also the only code
 * with no tests. A driver seam costs four lines and lets the suite run the
 * real SQL against a real Postgres (PGlite, in-process) on every commit.
 *
 * Production never calls this: `db()` falls through to Neon when it is unset.
 */
export function useDriver(driver: Driver | null): void {
  sql = driver;
}

export function db(): Driver {
  if (sql) return sql;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Rules cannot outlive the browser without it — see lib/db/schema.sql.",
    );
  }
  sql = neon(url) as unknown as Driver;
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
