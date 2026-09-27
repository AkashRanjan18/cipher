import type { Rule, Transition } from "@cipher/shared";
import type { Account, Fill } from "../account/paper.ts";

/**
 * The browser's half of server-side state.
 *
 * Thin on purpose: it turns HTTP into values and failures into nulls, and
 * makes no decisions. Whether cipher is in server mode at all is decided in
 * one place — lib/triggers/store.tsx — because a component that asks "is the
 * database up" in three places will eventually get three different answers.
 *
 * EVERY FUNCTION HERE CAN RETURN NULL, and null means "the server did not
 * answer", not "the answer was nothing". The caller falls back to local mode
 * rather than showing an empty account, because an empty account on a screen
 * that should show a balance reads as a wipe.
 */

export interface Snapshot {
  rules: Rule[];
  transitions: Transition[];
  account: Account | null;
  /** False when the worker's heartbeat is stale. The UI must say so. */
  watching: boolean;
}

/**
 * Why a snapshot did not arrive.
 *
 * "No database on this deployment" and "the network blipped" are the same
 * `null` to a caller that does not ask — and treating them the same means
 * polling a 503 every five seconds, forever, on a deployment where the feature
 * simply is not configured. That is 17,000 serverless invocations a day per
 * open tab, for nothing.
 */
export type SnapshotResult =
  | { kind: "ok"; snapshot: Snapshot }
  /** Permanent for this deployment. Stop asking. */
  | { kind: "unconfigured" }
  /** Might work next time. Keep asking. */
  | { kind: "unavailable" };

export async function fetchSnapshot(token: string | null): Promise<Snapshot | null> {
  const r = await fetchSnapshotResult(token);
  return r.kind === "ok" ? r.snapshot : null;
}

export async function fetchSnapshotResult(token: string | null): Promise<SnapshotResult> {
  /* No token right now is "ask again", not "no server": Privy can answer null
     for a moment while it refreshes, and treating that as permanent flipped a
     signed-in tab into local mode — firing rules the worker also fires. A
     real sign-out is handled by the stores' `authenticated` effects. */
  if (!token) return { kind: "unavailable" };
  try {
    const res = await fetch("/api/rules", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    /*
     * 503 is "no DATABASE_URL", which does not improve by asking again.
     *
     * 401 IS NOT PERMANENT, and treating it as permanent was the dangerous
     * half of the expired-token bug (27 Sep 2026). One 401 from a token that
     * had just lapsed flipped the rules store into local mode for the rest of
     * the tab — where it fires rules itself, while the worker fires the same
     * rules in Postgres. Two writers, one ledger. A 401 with a token in hand
     * is an expired token, and the next poll asks Privy for a fresh one.
     */
    if (res.status === 503) return { kind: "unconfigured" };
    if (!res.ok) return { kind: "unavailable" };
    const body = (await res.json()) as Snapshot;
    return {
      kind: "ok",
      snapshot: {
        rules: body.rules ?? [],
        transitions: body.transitions ?? [],
        account: body.account ?? null,
        watching: Boolean(body.watching),
      },
    };
  } catch {
    return { kind: "unavailable" };
  }
}

export async function armRemote(token: string | null, rules: Rule[]): Promise<boolean> {
  if (!token || rules.length === 0) return false;
  try {
    const res = await fetch("/api/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ rules }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function cancelRemote(token: string | null, id: string): Promise<boolean> {
  if (!token) return false;
  try {
    const res = await fetch(`/api/rules?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function tradeRemote(
  token: string | null,
  input: {
    /** WHICH COIN. Carried end to end; the route refuses a request without it. */
    mint: string;
    side: "buy" | "sell";
    qty: number;
    mark: number;
    /** For refusal sentences only. Never an identity. */
    symbol?: string;
    squawk?: string;
    source?: Fill["source"];
    depthUsd?: number | null;
    slippageBps?: number;
  },
): Promise<{ fill: Fill; account: Account } | { refusal: string; uncertain?: boolean } | null> {
  if (!token) return { refusal: "You're signed out. Sign in again — nothing happened." };
  try {
    const res = await fetch("/api/trade", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(input),
    });
    /*
     * SAY WHICH FAILURE IT WAS. Every non-2xx came back as "couldn't reach the
     * server" — including the 401 from an expired sign-in on 27 Sep 2026, when
     * the server was up and answering. Only a request that never got an answer
     * (the catch below) is "couldn't reach".
     */
    if (res.status === 401) return { refusal: "Your sign-in expired. Sign in again — nothing happened." };
    /*
     * ONLY A 4xx MEANS NOTHING HAPPENED. A 5xx can arrive after the trade was
     * booked — the function timed out, or the gateway gave up, after saveFill
     * ran — and "nothing happened" would invite a second click and a second
     * fill. Say the outcome is unknown; the caller re-reads the account.
     */
    if (res.status >= 500) {
      return {
        refusal: `The server errored (${res.status}), so I can't tell whether that went through. Check your positions before trying again.`,
        uncertain: true,
      };
    }
    if (!res.ok) return { refusal: `The server refused that (error ${res.status}). Nothing happened.` };
    const body = (await res.json()) as
      | { fill: Fill; account: Account }
      | { refusal: string; account: Account };
    return "refusal" in body ? { refusal: body.refusal } : body;
  } catch {
    return null;
  }
}

export async function resetRemote(token: string | null): Promise<Account | null> {
  if (!token) return null;
  try {
    const res = await fetch("/api/trade", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ reset: true }),
    });
    if (!res.ok) return null;
    return ((await res.json()) as { account: Account }).account;
  } catch {
    return null;
  }
}
