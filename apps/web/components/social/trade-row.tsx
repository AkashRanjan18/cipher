"use client";

import Link from "next/link";
import type { PublicTrade } from "@/lib/social/profiles";
import type { TokenMeta } from "@/components/trade/use-token-meta";
import { shortMint } from "@/components/trade/use-token-meta";
import { Avatar } from "@/components/trade/avatar";
import { usd, units, pct, since } from "@/lib/format";
import { sayHref, sayInSana } from "@/lib/social/say";
import { explorerUrl } from "@/lib/social/receipt-link";

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
 * So it is set as the row's main line, not as a footnote under the numbers.
 *
 * TWO THINGS A ROW CAN DO, both only when they are true:
 *
 *   Use this order   puts the sentence in your own prompt bar and stops there
 *                    (lib/social/say.ts). Offered only when the sentence is
 *                    intact — a trader who hides amounts has "$•••" in theirs,
 *                    and that is not an order anyone can place.
 *   Receipt          opens this fill's record on Solana devnet, once it has
 *                    been written (lib/chain/receipts.ts). No link until then.
 *
 * `use` says how the sentence travels: "here" when the row is inside the
 * terminal (the feed), "link" when it is on another page (a profile).
 */
export function TradeRow({
  t,
  meta,
  now,
  showWho = true,
  use = "here",
}: {
  t: PublicTrade;
  meta?: TokenMeta;
  now: number | null;
  showWho?: boolean;
  use?: "here" | "link";
}) {
  const coin = meta?.symbol ?? shortMint(t.mint);
  const up = (t.realisedPct ?? 0) >= 0;
  /* qty is null exactly when the trader hides amounts — see toPublicTrade. */
  const say = t.sentence && t.qty !== null ? { sentence: t.sentence, mint: t.mint } : null;
  const action = "font-semibold text-action underline-offset-2 hover:underline";
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
        {t.sentence && (
          <p className="line-clamp-2 text-[12.5px] leading-snug text-champagne">“{t.sentence}”</p>
        )}
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
        {(say || t.receipt) && (
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]">
            {say &&
              (use === "here" ? (
                <button onClick={() => sayInSana(say)} className={action}>
                  Use this order
                </button>
              ) : (
                <Link href={sayHref(say)} className={action}>
                  Use this order
                </Link>
              ))}
            {t.receipt && (
              <a
                href={explorerUrl(t.receipt)}
                target="_blank"
                rel="noreferrer"
                title="This trade's record on Solana devnet. Paper money: the record is real, no tokens moved."
                className="text-mute underline-offset-2 hover:text-champagne hover:underline"
              >
                Receipt on Solana devnet ↗
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
