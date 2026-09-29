"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useLiveToken } from "@/lib/auth/use-live-token";
import { fetchMe, fetchProfile, follow, saveMe, type Me, type PublicProfile } from "@/lib/social/client";
import { Avatar } from "@/components/trade/avatar";
import { useTokenMeta } from "@/components/trade/use-token-meta";
import { useNow } from "@/components/trade/use-now";
import { TradeRow } from "./trade-row";
import { usd } from "@/lib/format";

/**
 * A trader's public page.
 *
 * Every number on it is summed from their real fills, on the server. Nothing
 * ranks them against anyone: a leaderboard of own P&L selects for the lucky
 * (CLAUDE.md), and the ranking cipher will have — what a leader made OTHER
 * people — needs copy trading first.
 *
 * On YOUR OWN page it is also where you change your handle, choose to hide
 * your amounts, and find your referral link.
 */
export function ProfileView({ handle }: { handle: string }) {
  const { authenticated } = usePrivy();
  const liveToken = useLiveToken();
  const now = useNow(30_000);
  const [data, setData] = useState<PublicProfile | "missing" | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const meta = useTokenMeta(data && data !== "missing" ? data.trades.map((t) => t.mint) : []);

  const load = useCallback(async () => {
    setData(await fetchProfile(handle, await liveToken()));
  }, [handle, liveToken]);

  useEffect(() => {
    void load();
  }, [load, authenticated]);

  async function toggleFollow() {
    if (!data || data === "missing") return;
    setBusy(true);
    const error = await follow(await liveToken(), handle, !data.following);
    setBusy(false);
    if (error) setNote(error);
    else void load();
  }

  if (data === null) return <Shell><p className="text-ash">Loading…</p></Shell>;
  if (data === "missing") {
    return (
      <Shell>
        <p className="text-champagne">There is no @{handle} on cipher.</p>
      </Shell>
    );
  }

  const { profile, stats, trades } = data;
  const winRate = stats.sells > 0 ? Math.round((stats.wins / stats.sells) * 100) : null;

  return (
    <Shell>
      <section className="flex flex-wrap items-center gap-4 rounded-2xl border border-line bg-panel p-4">
        <Avatar who={profile.handle} size={56} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-sans text-[20px] font-semibold text-champagne">
            {profile.displayName ?? `@${profile.handle}`}
          </h1>
          <p className="font-sans text-[13px] text-ash">@{profile.handle}</p>
        </div>
        {!data.mine && (
          <button
            onClick={() => void toggleFollow()}
            disabled={busy || !authenticated}
            title={authenticated ? undefined : "Sign in to follow"}
            className={`rounded-xl px-4 py-2 font-sans text-[13px] font-semibold transition-colors disabled:opacity-60 ${
              data.following ? "border border-line text-ash hover:text-champagne" : "bg-action text-white"
            }`}
          >
            {!authenticated ? "Sign in to follow" : data.following ? "Following" : "Follow"}
          </button>
        )}
      </section>

      <section className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Stat label="Trades" value={String(stats.trades)} />
        <Stat label="Profitable sells" value={winRate === null ? "—" : `${winRate}%`} />
        <Stat
          label="Realised P&L"
          value={stats.realisedUsd === null ? "Hidden" : `${stats.realisedUsd >= 0 ? "+" : "−"}${usd(Math.abs(stats.realisedUsd))}`}
          tone={stats.realisedUsd === null ? undefined : stats.realisedUsd >= 0 ? "up" : "down"}
        />
        <Stat label="Followers" value={String(stats.followers)} />
        <Stat label="Following" value={String(stats.following)} />
      </section>
      <p className="-mt-2 px-1 font-sans text-[11px] text-mute">
        Paper money. Every figure is summed from this trader&apos;s real fills on cipher.
        {profile.hideAmounts ? " They hide their amounts: sizes and dollars are not shown." : ""}
      </p>

      {data.mine && <Settings onSaved={(h) => (h !== handle ? (window.location.href = `/u/${h}`) : void load())} />}

      <section className="overflow-hidden rounded-2xl border border-line bg-panel">
        <h2 className="border-b border-hairline px-3 py-2.5 font-sans text-[12px] font-semibold uppercase tracking-[0.08em] text-ash">
          Trades
        </h2>
        {trades.length === 0 ? (
          <p className="p-4 font-sans text-[12px] text-ash">No trades yet.</p>
        ) : (
          trades.map((t) => <TradeRow key={t.id} t={t} meta={meta[t.mint]} now={now} showWho={false} />)
        )}
      </section>
      {note && <p className="font-sans text-[12px] text-down">{note}</p>}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-dvh bg-ink px-4 py-6">
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <Link href="/trade" className="self-start font-sans text-[12px] text-ash hover:text-champagne">
          ← Back to the terminal
        </Link>
        {children}
      </div>
    </main>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  return (
    <div className="rounded-xl border border-line bg-panel px-3 py-2">
      <div className="font-sans text-[10px] font-semibold uppercase tracking-[0.08em] text-mute">{label}</div>
      <div
        className={`font-mono text-[15px] font-semibold tabular-nums ${
          tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-champagne"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

/**
 * Your own settings, on your own page. Everything is public by default,
 * amounts included (the user's call, 28 Sep 2026); hiding them is one switch.
 */
function Settings({ onSaved }: { onSaved: (handle: string) => void }) {
  const liveToken = useLiveToken();
  const [me, setMe] = useState<Me | null>(null);
  const [handle, setHandle] = useState("");
  const [name, setName] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void liveToken()
      .then(fetchMe)
      .then((m) => {
        if (!m) return;
        setMe(m);
        setHandle(m.profile.handle);
        setName(m.profile.displayName ?? "");
      });
  }, [liveToken]);

  if (!me) return null;
  const link = `${window.location.origin}/?ref=${me.referral.code}`;

  async function save(patch: { handle?: string; displayName?: string | null; hideAmounts?: boolean }) {
    const r = await saveMe(await liveToken(), patch);
    if ("error" in r) {
      setNote(r.error);
      return;
    }
    setNote("Saved.");
    setMe((m) => (m ? { ...m, profile: r.profile } : m));
    onSaved(r.profile.handle);
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-line bg-panel p-4 font-sans text-[13px]">
      <h2 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ash">Your profile</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save({ handle, displayName: name || null });
        }}
        className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
      >
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-mute">Handle</span>
          <input
            id="profile-handle"
            value={handle}
            onChange={(e) => setHandle(e.target.value.toLowerCase())}
            className="rounded-lg border border-line bg-slate px-2.5 py-1.5 text-champagne outline-none focus:border-action"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-mute">Display name</span>
          <input
            id="profile-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Optional"
            className="rounded-lg border border-line bg-slate px-2.5 py-1.5 text-champagne outline-none placeholder:text-mute focus:border-action"
          />
        </label>
        <button className="self-end rounded-lg bg-action px-4 py-1.5 font-semibold text-white">Save</button>
      </form>

      <label className="flex items-center gap-2 text-ash">
        <input
          id="profile-hide"
          type="checkbox"
          checked={me.profile.hideAmounts}
          onChange={(e) => void save({ hideAmounts: e.target.checked })}
        />
        Hide my amounts — others see what I traded and the percentage, not sizes or dollars
      </label>

      <div className="flex flex-col gap-1 border-t border-hairline pt-3">
        <span className="text-[11px] text-mute">Your referral link — friends who join with it pay 10% less on every fee, and you earn 25% of their fees</span>
        <div className="flex gap-2">
          <code className="min-w-0 flex-1 truncate rounded-lg bg-slate px-2.5 py-1.5 text-[12px] text-champagne">{link}</code>
          <button
            onClick={() => {
              navigator.clipboard.writeText(link).then(
                () => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1500);
                },
                () => setNote("Copy failed — select the link instead."),
              );
            }}
            className="rounded-lg border border-line px-3 text-[12px] text-ash hover:text-champagne"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <span className="text-[12px] text-ash">
          {me.referral.invitees} joined with your code · they paid {usd(me.referral.feesUsd)} in fees · you&apos;ve earned{" "}
          <b className="text-champagne">{usd(me.referral.earnedUsd)}</b> (paper)
          {me.referral.referred ? " · you joined with a code: 10% off your fees" : ""}
        </span>
      </div>
      {note && <p className="text-[12px] text-ash">{note}</p>}
    </section>
  );
}
