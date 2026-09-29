"use client";

import Link from "next/link";
import type { PublicTrade } from "@/lib/social/profiles";
import type { TokenMeta } from "@/components/trade/use-token-meta";
import { shortMint } from "@/components/trade/use-token-meta";
import { Avatar } from "@/components/trade/avatar";
import { usd, units, pct, since } from "@/lib/format";

/**
 * One real trade as others see it — in the Feed tab and on a profile.
 *
 * Everything shown is a field of a row in `fills`. What is null was removed
 * on the server because the trader hides amounts; it is left out here, never
 * replaced with a guess.
 *
 * THE SENTENCE IS THE POINT. A trade placed through Sana carries the words
 * that placed it — "buy $500 of sol and stop at 10%" — and that is what no
 * other trading feed can show: not just what someone did, but what they said.
 */
export function TradeRow({
  t,
  meta,
  now,
  showWho = true,
}: {
  t: PublicTrade;
  meta?: TokenMeta;
  now: number | null;
  showWho?: boolean;
}) {
  const coin = meta?.symbol ?? shortMint(t.mint);
  const up = (t.realisedPct ?? 0) >= 0;
  return (
    <div className="flex gap-2.5 border-b border-hairline px-3 py-2.5 last:border-b-0">
      {showWho && (
        <Link href={`/u/${t.handle}`} className="shrink-0 pt-0.5" aria-label={`@${t.handle}`}>
          <Avatar who={t.handle} size={26} />
        </Link>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 font-sans text-[12px] leading-snug">
        <div className="flex items-baseline gap-1.5">
          {showWho && (
            <Link href={`/u/${t.handle}`} className="truncate font-semibold text-champagne hover:underline">
              {t.displayName ?? `@${t.handle}`}
            </Link>
          )}
          <span className={t.side === "buy" ? "font-semibold text-up" : "font-semibold text-down"}>
            {t.side === "buy" ? "bought" : "sold"}
          </span>
          <span className="font-semibold text-champagne">{coin}</span>
          <span className="ml-auto shrink-0 text-[10.5px] text-mute">{since(t.ts, now)}</span>
        </div>
        <div className="text-ash">
          {t.qty !== null && t.valueUsd !== null
            ? `${units(t.qty)} ${coin} · ${usd(t.valueUsd)} · `
            : ""}
          at {usd(t.price)}
          {t.side === "sell" && t.realisedPct !== null && (
            <span className={up ? " text-up" : " text-down"}>
              {" "}
              · {pct(t.realisedPct, false)}
              {t.realisedUsd !== null ? ` (${t.realisedUsd >= 0 ? "+" : "−"}${usd(Math.abs(t.realisedUsd))})` : ""}
            </span>
          )}
        </div>
        {t.sentence && <p className="mt-0.5 truncate text-[11.5px] italic text-mute">“{t.sentence}”</p>}
      </div>
    </div>
  );
}
