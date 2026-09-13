/**
 * Identifiers that are unique across users, devices and processes.
 *
 * THIS EXISTS BECAUSE THREE SEPARATE GENERATORS WERE NOT, and in the browser
 * that was survivable while in Postgres it is not.
 *
 *   grammar.ts   `r${Date.now()}${seq++}` — two users arming a rule in the
 *                same millisecond, both with seq at 0 after a page load,
 *                produce the SAME id.
 *   sana/ticket  `e${Date.now()}` and `t${Date.now()}` — same problem, without
 *                even the counter.
 *   paper.ts     `f${ts}${fills.length}` — and the worker loads the account
 *                WITHOUT its fills, so that length is always 0. Two rungs of a
 *                ladder firing in the same second produced one id twice.
 *
 * In a browser a duplicate id overwrote a key in an object and nobody noticed.
 * In the database `on conflict (id) do nothing` means the second row is
 * silently DROPPED — and for a fill, that is a balance that moved with no
 * record of why. A ladder firing two rungs at once is exactly that case, which
 * makes it a normal Tuesday rather than a freak collision.
 *
 * Time first so ids sort roughly by creation, which makes a log readable.
 * Randomness second so uniqueness does not depend on a clock or a counter.
 */

const RAND_CHARS = 12;

export function newId(prefix: string): string {
  const time = Date.now().toString(36);
  return `${prefix}${time}${randomSuffix()}`;
}

function randomSuffix(): string {
  /*
   * crypto.randomUUID exists in every browser cipher supports and in Node 19+,
   * which covers the worker. The fallback is for nothing in particular — it is
   * there so that a missing global degrades to a weaker id rather than to a
   * thrown exception in the middle of arming an order.
   */
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID().replace(/-/g, "").slice(0, RAND_CHARS);
  if (c?.getRandomValues) {
    const bytes = new Uint8Array(6);
    c.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  return Math.random().toString(36).slice(2, 2 + RAND_CHARS).padEnd(RAND_CHARS, "0");
}
