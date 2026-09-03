"use client";

import { useState } from "react";
import { TradeTape } from "./trade-tape";
import type { Trade, TokenSecurity, Social } from "@/lib/market";

/**
 * The right-middle column: trades, holders, and safety behind three tabs.
 *
 * Tabbed rather than stacked because all three answer the same question — "do
 * I trust this token" — and a trader reads one at a time. Stacking them would
 * cost a whole column on a screen that already has four, and holders and
 * safety are consulted once before entering, not watched continuously the way
 * the tape is.
 */

type Tab = "trades" | "holders" | "info";

function pctBar(pct: number) {
  // Capped: a single wallet holding 60% would otherwise blow out the row.
  return `${Math.min(100, pct)}%`;
}

function Holders({ security }: { security: TokenSecurity | null }) {
  if (!security || security.topHolders.length === 0) {
    return <p className="p-3 font-mono text-[11px] text-ash">no holder data</p>;
  }

  /*
   * The number that matters is not any single holder, it is the top ten
   * together — that is the size of the position that can exit into you.
   */
  const top10 = security.topHolders
    .slice(0, 10)
    .reduce((sum, h) => sum + h.pct, 0);

  return (
    <div className="flex flex-col">
      <div className="flex items-baseline justify-between border-b border-champagne/10 px-3 py-2 font-mono text-[10px]">
        <span className="text-ash">
          {security.totalHolders.toLocaleString()} holders
        </span>
        <span className={top10 > 50 ? "text-red-400" : "text-ash"}>
          top 10 hold {top10.toFixed(1)}%
        </span>
      </div>

      {security.topHolders.map((h) => (
        <div
          key={h.address}
          className="flex items-center gap-2 border-b border-champagne/5 px-3 py-1.5"
        >
          <a
            href={`https://solscan.io/account/${h.address}`}
            target="_blank"
            rel="noreferrer"
            className="w-14 shrink-0 font-mono text-[11px] text-ash hover:text-champagne"
          >
            {h.address.slice(0, 4)}
          </a>

          <div className="h-1 flex-1 overflow-hidden rounded-full bg-champagne/10">
            <div
              className={h.insider ? "h-full bg-red-400/70" : "h-full bg-champagne/40"}
              style={{ width: pctBar(h.pct) }}
              aria-hidden
            />
          </div>

          <span className="w-12 shrink-0 text-right font-mono text-[11px] tabular-nums text-champagne">
            {h.pct.toFixed(2)}%
          </span>
          {/* Insider = upstream links this wallet to the deployer. Worth a
              glyph: the same 5% means different things from a stranger. */}
          {h.insider && (
            <span title="linked to deployer" className="text-[9px] text-red-400">
              ●
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function Check({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div className="flex items-start gap-2 px-3 py-2">
      <span className={ok ? "text-green-400" : "text-red-400"}>
        {ok ? "✓" : "✕"}
      </span>
      <div className="flex flex-col">
        <span className="font-mono text-[11px] text-champagne">{label}</span>
        <span className="font-sans text-[10px] leading-snug text-ash">
          {detail}
        </span>
      </div>
    </div>
  );
}

function Info({
  security,
  socials,
}: {
  security: TokenSecurity | null;
  socials: Social[];
}) {
  return (
    <div className="flex flex-col divide-y divide-champagne/5">
      {security && (
        <div className="flex flex-col">
          {/*
            Stated as consequences, not field names. "Mint authority: null"
            means nothing to someone who has never deployed a token; "supply
            is fixed" is the fact they are actually buying.
          */}
          <Check
            ok={security.mintAuthority === null}
            label="supply is fixed"
            detail={
              security.mintAuthority === null
                ? "mint authority revoked — no new supply can be created"
                : "mint authority is LIVE — the deployer can print more supply into your position"
            }
          />
          <Check
            ok={security.freezeAuthority === null}
            label="cannot be frozen"
            detail={
              security.freezeAuthority === null
                ? "freeze authority revoked — your account cannot be locked"
                : "freeze authority is LIVE — the deployer can stop you selling"
            }
          />
          <Check
            ok={security.lpLockedPct >= 50}
            label={`${security.lpLockedPct.toFixed(1)}% of LP locked`}
            detail={
              security.lpLockedPct >= 50
                ? "most of the pool cannot be withdrawn"
                : "most of the pool can be withdrawn — the liquidity you sell into may disappear"
            }
          />
        </div>
      )}

      {security && security.risks.length > 0 && (
        <div className="flex flex-col gap-1.5 px-3 py-2">
          <span className="font-mono text-[10px] tracking-[0.12em] text-ash">
            FLAGS
          </span>
          {security.risks.map((r) => (
            <div key={r.name} className="flex flex-col">
              <span
                className={`font-mono text-[11px] ${
                  r.level === "danger" ? "text-red-400" : "text-amber-400"
                }`}
              >
                {r.name}
              </span>
              <span className="font-sans text-[10px] leading-snug text-ash">
                {r.description}
              </span>
            </div>
          ))}
        </div>
      )}

      {socials.length > 0 && (
        <div className="flex flex-wrap gap-2 px-3 py-2">
          {socials.map((s) => (
            <a
              key={s.url}
              href={s.url}
              target="_blank"
              rel="noreferrer"
              className="rounded border border-champagne/15 px-2 py-1 font-mono text-[10px] lowercase text-ash hover:border-champagne/40 hover:text-champagne"
            >
              {s.type}
            </a>
          ))}
        </div>
      )}

      {!security && (
        <p className="p-3 font-mono text-[11px] text-ash">
          {/* Never render an absent check as a pass. */}
          safety data unavailable — treat as unverified
        </p>
      )}
    </div>
  );
}

export function SidePanel({
  pair,
  trades,
  security,
  socials,
}: {
  pair: string;
  trades: Trade[];
  security: TokenSecurity | null;
  socials: Social[];
}) {
  const [tab, setTab] = useState<Tab>("trades");

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-champagne/10 bg-slate">
      <div className="flex shrink-0 gap-1 border-b border-champagne/10 px-2 py-1.5">
        {(["trades", "holders", "info"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            aria-pressed={tab === t}
            className={`rounded px-2 py-1 font-mono text-[11px] transition-colors ${
              tab === t
                ? "bg-champagne/15 text-champagne"
                : "text-ash hover:text-champagne"
            }`}
          >
            {t}
          </button>
        ))}
        {/* A live token with a live mint authority is the single most common
            way people lose everything. It gets a marker on the tab itself, so
            it is visible without opening the panel. */}
        {security?.mintAuthority !== null && security !== null && (
          <span
            title="mint authority is live"
            className="ml-auto self-center text-[10px] text-red-400"
          >
            ⚠
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "trades" && <TradeTape pair={pair} initial={trades} bare />}
        {tab === "holders" && <Holders security={security} />}
        {tab === "info" && <Info security={security} socials={socials} />}
      </div>
    </div>
  );
}
