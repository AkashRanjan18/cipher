import { db, num } from "./client.ts";

/**
 * THE PROMPT LOG: every sentence, what it became, and what happened next.
 *
 * The parser is the product, and until now nothing recorded how well it
 * actually reads. Tests cover the sentences we thought of; this records the
 * ones people type. A month of these is the backlog: the refusals are the
 * grammar rules worth writing, and the ones the model answered are the ones a
 * rule would make instant and free.
 *
 * WRITING HERE CAN NEVER COST A TRADE. Every call is best-effort and the
 * caller must not await it in a path that moves money — see `record()`. A
 * logging table that can fail an order is worse than no logging table.
 */

/** What the person ended up with, which is not the same as what parsed. */
export type Outcome =
  /** An order ran: a fill, or a rule armed. */
  | "executed"
  /** cipher asked a question back — a size, a price, a which-token. */
  | "asked"
  /** Refused, with a reason the user was shown. */
  | "refused"
  /** Understood and then something broke: no route, no price, a 502. */
  | "failed";

export interface PromptEntry {
  /** Null when signed out. The sentence is still worth having. */
  userId: string | null;
  at: number;
  text: string;
  /** Which reader answered: the grammar, the model, or neither. */
  reader: "grammar" | "model" | "none";
  provider?: string | null;
  /** The Intent kind the compiler produced. */
  kind: string;
  reason?: string | null;
  /** The compiled OrderSpec, when there was one. */
  spec?: unknown;
  outcome: Outcome;
  market?: string | null;
  /** How long the whole compile took, in ms. */
  ms?: number | null;
}

/**
 * The longest sentence worth keeping.
 *
 * The compile route already refuses anything over 400 characters, so this is
 * the belt to that brace: a client can post straight here, and a log table is
 * not a place to let a stranger write a megabyte.
 */
export const MAX_TEXT = 400;

export async function record(entry: PromptEntry): Promise<void> {
  const text = entry.text.trim().slice(0, MAX_TEXT);
  if (!text) return;
  await db()`
    insert into prompts (user_id, at, text, reader, provider, kind, reason, spec, outcome, market, ms)
    values (
      ${entry.userId}, ${entry.at}, ${text}, ${entry.reader}, ${entry.provider ?? null},
      ${entry.kind}, ${entry.reason ?? null},
      ${entry.spec === undefined ? null : JSON.stringify(entry.spec)},
      ${entry.outcome}, ${entry.market ?? null}, ${entry.ms ?? null}
    )
  `;
}

export interface Stats {
  total: number;
  /** By outcome: executed, asked, refused, failed. */
  outcomes: Record<string, number>;
  /** By reader: how much of the traffic the free path answered. */
  readers: Record<string, number>;
  /**
   * Orders that carried at least one exit.
   *
   * THE NUMBER THIS PRODUCT IS ABOUT. Anyone can turn a sentence into a market
   * buy; cipher exists because the same sentence sets the stop. If this is low
   * the pitch is wrong, and no amount of parser work fixes that.
   */
  withExit: number;
  orders: number;
}

/**
 * The shape of the last `days` of traffic.
 *
 * One query per axis rather than one clever one: these run on a human looking
 * at a dashboard, not on a tick, and three readable queries beat a pivot
 * nobody can modify later.
 */
export async function stats(days = 30): Promise<Stats> {
  const sql = db();
  const since = Date.now() - days * 86_400_000;

  const byOutcome = (await sql`
    select outcome, count(*)::int as n from prompts where at >= ${since} group by outcome
  `) as { outcome: string; n: unknown }[];

  const byReader = (await sql`
    select reader, count(*)::int as n from prompts where at >= ${since} group by reader
  `) as { reader: string; n: unknown }[];

  const [exits] = (await sql`
    select
      count(*) filter (where kind = 'order')::int as orders,
      count(*) filter (where kind = 'order' and jsonb_array_length(coalesce(spec->'exits', '[]'::jsonb)) > 0)::int as with_exit
    from prompts where at >= ${since}
  `) as { orders: unknown; with_exit: unknown }[];

  const outcomes: Record<string, number> = {};
  for (const r of byOutcome) outcomes[r.outcome] = num(r.n);
  const readers: Record<string, number> = {};
  for (const r of byReader) readers[r.reader] = num(r.n);

  return {
    total: Object.values(outcomes).reduce((a, b) => a + b, 0),
    outcomes,
    readers,
    orders: num(exits?.orders ?? 0),
    withExit: num(exits?.with_exit ?? 0),
  };
}

/**
 * The sentences that did not work, newest first.
 *
 * The working list. Each one is either a grammar rule worth writing or a
 * prompt line worth adding, and reading twenty of them is a better guide to
 * what to build next than any amount of guessing.
 */
export async function failures(limit = 50): Promise<{ text: string; kind: string; reason: string | null; at: number }[]> {
  const rows = (await db()`
    select text, kind, reason, at from prompts
    where outcome in ('refused', 'failed')
    order by at desc, id desc
    limit ${limit}
  `) as { text: string; kind: string; reason: string | null; at: unknown }[];
  return rows.map((r) => ({ ...r, at: num(r.at) }));
}
