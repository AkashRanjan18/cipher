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
  if (!token) return { kind: "unconfigured" };
  try {
    const res = await fetch("/api/rules", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    /*
     * 503 is "no DATABASE_URL" and 401 is "this token is not a session" —
     * neither improves by asking again in five seconds.
     */
    if (res.status === 503 || res.status === 401) return { kind: "unconfigured" };
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
): Promise<{ fill: Fill; account: Account } | { refusal: string } | null> {
  if (!token) return null;
  try {
    const res = await fetch("/api/trade", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(input),
    });
    if (!res.ok) return null;
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
