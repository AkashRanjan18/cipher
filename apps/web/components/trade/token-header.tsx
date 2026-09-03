"use client";

import { useEffect, useRef, useState } from "react";
import { useLive } from "./live-price";
import { useNow } from "./use-now";
import type { Social } from "@/lib/market";
import { usd, compactUsd, pct, since } from "@/lib/format";

/**
 * The token identity strip and the five headline stats.
 *
 * A client component, because these are the numbers that move. It reads the
 * shared poll from <LivePrice> rather than fetching, so the header and the
 * chart cost one request between them instead of two.
 *
 * Stats sit in bordered boxes rather than a plain row: on a dense screen the
 * eye needs an anchor per number, and a run of five bare figures reads as one
 * paragraph.
 */

function Box({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "up" | "down";
}) {
  return (
    <div className="flex min-w-[104px] flex-col gap-1 rounded-xl border border-line bg-panel px-3.5 py-2">
      <span className="font-sans text-[11px] text-ash">{label}</span>
      <span
        className={`font-mono text-base tabular-nums ${
          tone === "up"
            ? "text-up"
            : tone === "down"
              ? "text-down"
              : "text-champagne"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

/** Copy the mint — the action a memecoin trader takes constantly. */
function CopyMint({ mint }: { mint: string }) {
  const [done, setDone] = useState(false);

  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(mint);
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        } catch {
          // Clipboard is permission-gated and can simply refuse. Saying
          // nothing beats claiming a copy that did not happen.
        }
      }}
      title={mint}
      className="flex items-center gap-1 rounded border border-line px-1.5 py-0.5 font-mono text-[11px] text-ash transition-colors hover:border-champagne/30 hover:text-champagne"
    >
      {mint.slice(0, 4)}…{mint.slice(-4)}
      <span className={done ? "text-up" : ""}>{done ? "✓" : "⧉"}</span>
    </button>
  );
}

const SOCIAL_LABEL: Record<string, string> = {
  website: "web",
  twitter: "X",
  telegram: "TG",
  discord: "DC",
};

function LivePriceBox({ price, fresh }: { price: number; fresh: boolean }) {
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  const prev = useRef(price);

  useEffect(() => {
    if (price === prev.current) return;
    setFlash(price > prev.current ? "up" : "down");
    prev.current = price;
    const id = setTimeout(() => setFlash(null), 600);
    return () => clearTimeout(id);
  }, [price]);

  return (
    <div className="flex min-w-[104px] flex-col gap-1 rounded-xl border border-line bg-panel px-3.5 py-2">
      <span className="flex items-center gap-1 font-sans text-[11px] text-ash">
        Price
        {/* Absence of the dot is the "live" signal; its presence means the
            last poll failed and the number is the last one we trusted. */}
        {!fresh && (
          <span
            title="price feed stale — showing last known"
            className="h-1 w-1 rounded-full bg-amber-400/80"
          />
        )}
      </span>
      <span
        className={`rounded font-mono text-base tabular-nums transition-colors duration-500 ${
          flash === "up"
            ? "bg-up/25 text-up"
            : flash === "down"
              ? "bg-down/25 text-down"
              : "text-champagne"
        }`}
      >
        {usd(price)}
      </span>
    </div>
  );
}

export function TokenHeader({ socials }: { socials: Social[] }) {
  const { stats, fresh } = useLive();
  const now = useNow(60_000);
  const day = stats.windows.h24;
  const up = (day.change ?? 0) >= 0;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="flex items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element --
            next/image would need every token CDN listed in next.config, and
            the hosts are whatever DexScreener happens to use per token. */}
        {stats.imageUrl && (
          <img
            src={stats.imageUrl}
            alt=""
            className="h-10 w-10 rounded-full border border-line object-cover"
          />
        )}

        <div className="flex flex-col gap-0.5">
          <div className="flex items-baseline gap-2">
            <h1 className="font-display text-2xl lowercase leading-none text-champagne">
              {stats.symbol}
            </h1>
            {/* Many tokens report an identical symbol and name; printing both
                then reads as a bug. */}
            {stats.name.toLowerCase() !== stats.symbol.toLowerCase() && (
              <span className="font-sans text-xs text-ash">{stats.name}</span>
            )}
            <span className="rounded border border-champagne/15 px-1.5 py-0.5 font-mono text-[11px] uppercase text-ash">
              {stats.dex}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <CopyMint mint={stats.mint} />
            {stats.createdAt && (
              <span title="pool age" className="font-mono text-[11px] text-ash">
                {since(stats.createdAt, now)}
              </span>
            )}
            {socials.map((s) => (
              <a
                key={s.url}
                href={s.url}
                target="_blank"
                rel="noreferrer"
                className="rounded border border-line px-1.5 py-0.5 font-mono text-[11px] text-ash hover:border-champagne/30 hover:text-champagne"
              >
                {SOCIAL_LABEL[s.type] ?? s.type}
              </a>
            ))}
          </div>
        </div>
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <Box label="Market cap" value={compactUsd(stats.marketCap)} />
        <LivePriceBox price={stats.priceUsd} fresh={fresh} />
        <Box
          label="24h change"
          value={
            day.change === null
              ? "—"
              : pct(day.change, false)
          }
          tone={day.change === null ? undefined : up ? "up" : "down"}
        />
        <Box label="24h vol" value={compactUsd(day.volume)} />
        <Box label="Liquidity" value={compactUsd(stats.liquidityUsd)} />
      </div>
    </div>
  );
}
