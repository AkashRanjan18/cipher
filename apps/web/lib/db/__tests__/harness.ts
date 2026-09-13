import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { useDriver, type Driver } from "../client.ts";

/**
 * A real Postgres, in this process, with no account and no daemon.
 *
 * PGlite is Postgres itself compiled to WebAssembly — not a mock and not an
 * emulation, so `jsonb`, `numeric`, partial indexes, `on conflict ... where`
 * and the exactly-once `update ... returning` all behave the way Neon will.
 * That matters more here than anywhere else in cipher: this folder is the code
 * that fires other people's stops while nobody is watching, and until now the
 * only way to execute a single line of it was to own a Neon account.
 *
 * The one thing it cannot tell us is how Neon's HTTP driver behaves — each
 * query on its own connection, no transactions. That limitation is honoured in
 * the code (see the comment on saveFill) rather than discovered here.
 */

const SCHEMA = fileURLToPath(new URL("../schema.sql", import.meta.url));

export interface Harness {
  pg: PGlite;
  /** Empty every table, keeping the schema. Cheaper than a new database. */
  reset(): Promise<void>;
  close(): Promise<void>;
}

export async function database(): Promise<Harness> {
  const pg = await PGlite.create();
  const schema = readFileSync(SCHEMA, "utf8");

  /* Applied TWICE on purpose. Every statement is `if not exists`, and the
     claim that the file is safe to re-run against a live database is worth
     exactly as much as a test of it. */
  await pg.exec(schema);
  await pg.exec(schema);

  useDriver(driverFor(pg));

  return {
    pg,
    async reset() {
      await pg.exec(`
        truncate rule_transitions, rules, fills, accounts, users,
                 market_prices, price_ticks, markets restart identity cascade;
      `);
    },
    async close() {
      useDriver(null);
      await pg.close();
    },
  };
}

/**
 * Neon's tagged template, spoken to PGlite.
 *
 * Neon interpolates every `${}` as a bound parameter rather than as text,
 * which is the only reason the query files can be written this way without
 * being an injection hazard. The shim has to preserve that exactly — building
 * `$1, $2, ...` — or the tests would be exercising a different query shape
 * than production runs.
 */
function driverFor(pg: PGlite): Driver {
  return async (strings, ...values) => {
    let text = strings[0];
    for (let i = 0; i < values.length; i++) text += `$${i + 1}${strings[i + 1]}`;
    const res = await pg.query(text, values.map((v) => (v === undefined ? null : v)));
    return res.rows as Record<string, unknown>[];
  };
}
