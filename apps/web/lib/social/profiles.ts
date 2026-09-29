import { db, num } from "../db/client.ts";
import { REFERRER_SHARE } from "../account/paper.ts";

/**
 * The social layer: who someone is, what they traded, who follows whom, and
 * who brought whom in.
 *
 * THE RULES IT KEEPS (CLAUDE.md and the user, 28 Sep 2026):
 *
 *   - nothing here is invented. Every trade shown is a row in `fills`, every
 *     person a row in `profiles`, every number summed from those.
 *   - public by default, amounts included. A user may hide amounts: then
 *     others see the coin, the side, the price and the percentage — never the
 *     size, the dollars, or the dollar figures in the sentence behind it.
 *   - no leaderboard of own P&L. Leaders are ranked on what they made OTHER
 *     people, which needs copy trading; until then there is no ranking here.
 *   - referrals are the fee schedule's: the invitee pays 10% less forever, the
 *     referrer earns 25% of what the invitee pays. Earnings are summed from
 *     `fills`, never stored, so there is no second ledger to drift.
 *
 * Server-only (it talks to Postgres). The routes in app/api/social are
 * authorisation around these functions and nothing else.
 */

type Row = Record<string, unknown>;

export const HANDLE = /^[a-z0-9_]{3,20}$/;

export interface Profile {
  userId: string;
  handle: string;
  displayName: string | null;
  hideAmounts: boolean;
  referralCode: string;
  referredBy: string | null;
}

function toProfile(r: Row): Profile {
  return {
    userId: String(r.user_id),
    handle: String(r.handle),
    displayName: r.display_name == null ? null : String(r.display_name),
    hideAmounts: Boolean(r.hide_amounts),
    referralCode: String(r.referral_code),
    referredBy: r.referred_by == null ? null : String(r.referred_by),
  };
}

/** Lowercase letters and digits, no look-alikes (0/o, 1/l), for codes people type. */
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
function random(n: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("");
}

/**
 * The user's profile, created on first need.
 *
 * A generated handle ("trader_k3m9qx") rather than one taken from the email:
 * an email's local part is often a real name, and a profile that is public by
 * default must not publish one the user never chose to show.
 */
export async function ensureProfile(userId: string): Promise<Profile> {
  const found = await profileOf(userId);
  if (found) return found;
  for (let attempt = 0; attempt < 6; attempt++) {
    const rows = (await db()`
      insert into profiles (user_id, handle, referral_code)
      values (${userId}, ${"trader_" + random(6)}, ${random(7)})
      on conflict do nothing
      returning *
    `) as Row[];
    if (rows[0]) return toProfile(rows[0]);
    /* Either a handle/code collision (try again) or another request created
       it a moment ago (read it). */
    const raced = await profileOf(userId);
    if (raced) return raced;
  }
  throw new Error("could not create a profile");
}

export async function profileOf(userId: string): Promise<Profile | null> {
  const rows = (await db()`select * from profiles where user_id = ${userId}`) as Row[];
  return rows[0] ? toProfile(rows[0]) : null;
}

export async function profileByHandle(handle: string): Promise<Profile | null> {
  const rows = (await db()`select * from profiles where handle = ${handle.toLowerCase()}`) as Row[];
  return rows[0] ? toProfile(rows[0]) : null;
}

export async function updateProfile(
  userId: string,
  patch: { handle?: string; displayName?: string | null; hideAmounts?: boolean },
): Promise<{ profile: Profile } | { error: string }> {
  const current = await ensureProfile(userId);
  const handle = patch.handle === undefined ? current.handle : patch.handle.trim().toLowerCase();
  if (!HANDLE.test(handle)) {
    return { error: "A handle is 3 to 20 characters: lowercase letters, numbers and underscores." };
  }
  const displayName =
    patch.displayName === undefined ? current.displayName : (patch.displayName?.trim() || null);
  if (displayName && displayName.length > 40) return { error: "A display name is at most 40 characters." };
  const hideAmounts = patch.hideAmounts ?? current.hideAmounts;

  if (handle !== current.handle) {
    const taken = await profileByHandle(handle);
    if (taken) return { error: `@${handle} is taken.` };
  }
  try {
    const rows = (await db()`
      update profiles set handle = ${handle}, display_name = ${displayName}, hide_amounts = ${hideAmounts}
      where user_id = ${userId}
      returning *
    `) as Row[];
    return { profile: toProfile(rows[0]) };
  } catch {
    /* The unique index lost a race to another user taking the same handle. */
    return { error: `@${handle} is taken.` };
  }
}

/* ────────────────────────────── public trades ──────────────────────────── */

export interface PublicTrade {
  id: string;
  ts: number;
  mint: string;
  side: "buy" | "sell";
  /** USD per token. Always shown: a price says nothing about size. */
  price: number;
  /** Tokens. Null when the trader hides amounts. */
  qty: number | null;
  /** Dollars traded. Null when hidden. */
  valueUsd: number | null;
  /** Dollars booked by a sell. Null on a buy, or when hidden. */
  realisedUsd: number | null;
  /** Percent booked by a sell, against its cost. Null on a buy. */
  realisedPct: number | null;
  /** The Sana sentence that placed it, with dollar amounts masked if hidden. */
  sentence: string | null;
  source: string;
  handle: string;
  displayName: string | null;
}

/**
 * One fill as others may see it.
 *
 * Exported for the tests: the hide-amounts rule is the one promise in this
 * file a user relies on, and it is enforced here, on the server, so a hidden
 * number never reaches a browser that could show it.
 */
export function toPublicTrade(r: Row): PublicTrade {
  const hide = Boolean(r.hide_amounts);
  const qty = num(r.qty);
  const price = num(r.price);
  const fee = num(r.fee_usd);
  const realised = num(r.realised_usd);
  const side = r.side === "sell" ? "sell" : "buy";
  /* A sell's cost is what the tokens were bought for: proceeds net of fee,
     less what was booked. */
  const cost = qty * price - fee - realised;
  const squawk = r.squawk == null ? "" : String(r.squawk).trim();
  return {
    id: String(r.id),
    ts: num(r.ts),
    mint: String(r.mint),
    side,
    price,
    qty: hide ? null : qty,
    valueUsd: hide ? null : qty * price,
    realisedUsd: side === "sell" && !hide ? realised : null,
    realisedPct: side === "sell" && cost > 0 ? (realised / cost) * 100 : null,
    sentence: squawk ? (hide ? maskAmounts(squawk) : squawk) : null,
    source: String(r.source),
    handle: String(r.handle),
    displayName: r.display_name == null ? null : String(r.display_name),
  };
}

/** "$500", "$1.5k", "500 dollars", "2 tokens" → masked. */
export function maskAmounts(s: string): string {
  return s
    .replace(/\$\s*[\d.,]*\d(?:\s*[km]\b)?/gi, "$•••")
    .replace(/\b[\d.,]+\s*(?:k|m)?\s*(?:dollars?|bucks|usd|usdc|tokens?|coins?)\b/gi, "•••");
}

export async function publicTrades(userId: string, limit = 50): Promise<PublicTrade[]> {
  const rows = (await db()`
    select f.*, p.handle, p.display_name, p.hide_amounts
    from fills f join profiles p on p.user_id = f.user_id
    where f.user_id = ${userId}
    order by f.ts desc, f.id desc
    limit ${limit}
  `) as Row[];
  return rows.map(toPublicTrade);
}

export interface Stats {
  trades: number;
  sells: number;
  /** Sells that booked a profit. */
  wins: number;
  /** Null when the trader hides amounts. */
  realisedUsd: number | null;
  followers: number;
  following: number;
}

export async function statsOf(userId: string, hideAmounts: boolean): Promise<Stats> {
  const [f] = (await db()`
    select count(*)::int as trades,
           count(*) filter (where side = 'sell')::int as sells,
           count(*) filter (where side = 'sell' and realised_usd > 0)::int as wins,
           coalesce(sum(realised_usd), 0) as realised
    from fills where user_id = ${userId}
  `) as Row[];
  const [g] = (await db()`
    select (select count(*)::int from follows where followee_id = ${userId}) as followers,
           (select count(*)::int from follows where follower_id = ${userId}) as following
  `) as Row[];
  return {
    trades: num(f.trades),
    sells: num(f.sells),
    wins: num(f.wins),
    realisedUsd: hideAmounts ? null : num(f.realised),
    followers: num(g.followers),
    following: num(g.following),
  };
}

/* ─────────────────────────────── following ─────────────────────────────── */

export async function setFollow(
  followerId: string,
  handle: string,
  on: boolean,
): Promise<{ ok: true } | { error: string }> {
  const target = await profileByHandle(handle);
  if (!target) return { error: `There is no @${handle}.` };
  if (target.userId === followerId) return { error: "You can't follow yourself." };
  if (on) {
    await db()`
      insert into follows (follower_id, followee_id) values (${followerId}, ${target.userId})
      on conflict do nothing
    `;
  } else {
    await db()`delete from follows where follower_id = ${followerId} and followee_id = ${target.userId}`;
  }
  return { ok: true };
}

export async function isFollowing(followerId: string, followeeId: string): Promise<boolean> {
  const rows = await db()`
    select 1 from follows where follower_id = ${followerId} and followee_id = ${followeeId}
  `;
  return rows.length > 0;
}

/**
 * The trades of everyone this user follows, newest first. Real fills only —
 * an empty feed says so, it is never padded.
 */
export async function feedFor(userId: string, limit = 50): Promise<PublicTrade[]> {
  const rows = (await db()`
    select f.*, p.handle, p.display_name, p.hide_amounts
    from follows w
    join fills f on f.user_id = w.followee_id
    join profiles p on p.user_id = f.user_id
    where w.follower_id = ${userId}
    order by f.ts desc, f.id desc
    limit ${limit}
  `) as Row[];
  return rows.map(toPublicTrade);
}

/* ─────────────────────────────── referrals ─────────────────────────────── */

/**
 * Sign up under someone's code: 10% off every fee from now on.
 *
 * ONLY BEFORE THE FIRST TRADE. A referral is how someone arrives, not a
 * coupon an existing trader can go and find; and without this rule two
 * accounts could refer each other for a permanent discount and a kickback.
 * Once only, never yourself.
 */
export async function applyReferral(
  userId: string,
  code: string,
): Promise<{ ok: true } | { error: string }> {
  const me = await ensureProfile(userId);
  if (me.referredBy) return { error: "You already joined with a code." };
  const clean = code.trim().toLowerCase();
  const [owner] = (await db()`select user_id from profiles where referral_code = ${clean}`) as Row[];
  if (!owner) return { error: "That code doesn't exist." };
  if (String(owner.user_id) === userId) return { error: "That's your own code." };
  const traded = await db()`select 1 from fills where user_id = ${userId} limit 1`;
  if (traded.length > 0) return { error: "Codes apply to new accounts, before the first trade." };
  const rows = await db()`
    update profiles set referred_by = ${String(owner.user_id)}, referred_at = now()
    where user_id = ${userId} and referred_by is null
    returning user_id
  `;
  return rows.length > 0 ? { ok: true } : { error: "You already joined with a code." };
}

export interface ReferralSummary {
  code: string;
  invitees: number;
  /** cipher's fees paid by everyone this user referred, since they joined. */
  feesUsd: number;
  /** REFERRER_SHARE of that. Paper money until the relayer lands. */
  earnedUsd: number;
  /** Whether this user joined under someone else's code (10% off). */
  referred: boolean;
}

export async function referralSummary(userId: string): Promise<ReferralSummary> {
  const me = await ensureProfile(userId);
  const [r] = (await db()`
    select count(distinct p.user_id)::int as invitees,
           coalesce(sum(f.fee_usd), 0) as fees
    from profiles p
    left join fills f on f.user_id = p.user_id
    where p.referred_by = ${userId}
  `) as Row[];
  const fees = num(r.fees);
  return {
    code: me.referralCode,
    invitees: num(r.invitees),
    feesUsd: fees,
    earnedUsd: fees * REFERRER_SHARE,
    referred: me.referredBy !== null,
  };
}
