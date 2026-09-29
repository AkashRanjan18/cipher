"use client";

import type { Profile, PublicTrade, ReferralSummary, Stats } from "./profiles";

/**
 * The browser's half of the social layer: HTTP in, values out.
 *
 * Every call takes a token from useLiveToken (lib/auth/use-live-token.ts) —
 * never one held from sign-in, which expires after about an hour.
 */

function authed(token: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export interface Me {
  profile: Profile;
  stats: Stats;
  referral: ReferralSummary;
}

export async function fetchMe(token: string | null): Promise<Me | null> {
  if (!token) return null;
  try {
    const res = await fetch("/api/social/me", { headers: authed(token), cache: "no-store" });
    return res.ok ? ((await res.json()) as Me) : null;
  } catch {
    return null;
  }
}

export async function saveMe(
  token: string | null,
  patch: { handle?: string; displayName?: string | null; hideAmounts?: boolean },
): Promise<{ profile: Profile } | { error: string }> {
  try {
    const res = await fetch("/api/social/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authed(token) },
      body: JSON.stringify(patch),
    });
    return (await res.json()) as { profile: Profile } | { error: string };
  } catch {
    return { error: "Couldn't reach the server." };
  }
}

export interface PublicProfile {
  profile: { handle: string; displayName: string | null; hideAmounts: boolean };
  stats: Stats;
  trades: PublicTrade[];
  following: boolean;
  mine: boolean;
}

export async function fetchProfile(handle: string, token: string | null): Promise<PublicProfile | "missing" | null> {
  try {
    const res = await fetch(`/api/social/profile?handle=${encodeURIComponent(handle)}`, {
      headers: authed(token),
      cache: "no-store",
    });
    if (res.status === 404) return "missing";
    return res.ok ? ((await res.json()) as PublicProfile) : null;
  } catch {
    return null;
  }
}

export async function follow(token: string | null, handle: string, on: boolean): Promise<string | null> {
  try {
    const res = await fetch("/api/social/follow", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authed(token) },
      body: JSON.stringify({ handle, follow: on }),
    });
    if (res.status === 401) return "Sign in to follow people.";
    const body = (await res.json()) as { ok?: true; error?: string };
    return body.error ?? null;
  } catch {
    return "Couldn't reach the server.";
  }
}

export async function fetchFeed(token: string | null): Promise<PublicTrade[] | null> {
  if (!token) return null;
  try {
    const res = await fetch("/api/social/feed", { headers: authed(token), cache: "no-store" });
    return res.ok ? ((await res.json()) as { trades: PublicTrade[] }).trades : null;
  } catch {
    return null;
  }
}

/* Not named use…: React's rules would take it for a hook. */
export async function redeemReferral(token: string | null, code: string): Promise<string | null> {
  try {
    const res = await fetch("/api/social/referral", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authed(token) },
      body: JSON.stringify({ code }),
    });
    const body = (await res.json()) as { ok?: true; error?: string };
    return body.error ?? null;
  } catch {
    return "Couldn't reach the server.";
  }
}
