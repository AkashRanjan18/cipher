"use client";

import { useState } from "react";
import { WINDOWS, type TokenInfo, type WindowKey } from "@/lib/chain/tokens";
import { compactUsd, pct } from "@/lib/format";

/**
 * What this token IS, and who has been trading it.
 *
 * Built to fomo's panel, which sits under the ticket and answers the question
 * a trader asks between deciding to look and deciding to buy: is anything
 * happening here, and is it one-sided.
 *
 * TWO THINGS IN THE REFERENCE ARE NOT BUILT, and both were left out rather
 * than approximated.
 *
 *   THE 4H CHIP. fomo shows 5M · 1H · 4H · 1D. Jupiter reports 5m, 1h, 6h and
 *   24h, and there is no four-hour window anywhere in the payload. The chip
 *   reads 6H here. A label is a claim about the period a number covers, and
 *   the number is worthless the moment the label is wrong.
 *
 *   BUYERS AND SELLERS. fomo's third bar reads "655 buyers / 826 sellers".
 *   Jupiter reports `numBuys` and `numSells` — TRADES, not people — and one
 *   combined `numTraders`. There is no split of wallets by side to be had, so
 *   this shows the trade counts under their own honest label and puts the
 *   trader count in the facts below. Rendering a split we cannot measure would
 *   be inventing a claim about how many people are on each side of a market,
 *   which is the exact thing the design rule in CLAUDE.md forbids.
 */

/** The label each window may honestly wear. 24h is a day; 6h is not 4h. */
const LABEL: Record<WindowKey, string> = {
  "5m": "5M",
  "1h": "1H",
  "6h": "6H",
  "24h": "1D",
};

/** Whole numbers with separators. Counts are counts, never abbreviated to "1K". */
const count = new Intl.NumberFormat("en-US");

/**
 * Supply, in the shorthand people quote it in.
 *
 * Not `compactUsd` — this is a token count and a dollar sign on it would read
 * as a valuation, which is the number directly above it.
 */
function supply(n: number): string {
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return count.format(Math.round(n));
}

/**
 * One two-sided bar: a green share and an orange share of the same row.
 *
 * The bar is the point rather than decoration. Two numbers side by side make
 * you do the division; a bar that is two-thirds orange says "more selling than
 * buying" before you have read either figure.
 */
function Split({
  label,
  left,
  right,
  leftValue,
  rightValue,
}: {
  label: string;
  left: string;
  right: string;
  leftValue: number;
  rightValue: number;
}) {
  const total = leftValue + rightValue;
  /*
   * Half each when nothing has traded. A zero-width bar reads as a rendering
   * failure, and 0 vs 0 genuinely is an even split — there is no imbalance to
   * show because there is nothing there.
   */
  const share = total > 0 ? (leftValue / total) * 100 : 50;

  return (
    <div className="flex flex-col gap-1" aria-label={label}>
      <div className="flex items-baseline justify-between gap-2 font-mono text-[11.5px] tabular-nums">
        <span className="truncate text-champagne">{left}</span>
        <span className="truncate text-champagne">{right}</span>
      </div>
      {/* One track, two fills. `flex` rather than an absolute overlay so the
          two shares can never sum to more than the row. */}
      <div className="flex h-1 overflow-hidden rounded-full bg-hairline">
        <div className="bg-up" style={{ width: `${share}%` }} />
        <div className="flex-1 bg-down" />
      </div>
    </div>
  );
}

/** A plain key/value line for the facts that have no second side. */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className="font-sans text-[11.5px] text-ash">{label}</dt>
      <dd className="font-mono text-[11.5px] tabular-nums text-champagne">{value}</dd>
    </div>
  );
}

function LinkChip({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      /* noreferrer as well as noopener: the target should not be told which
         terminal the click came from. */
      rel="noopener noreferrer"
      className="flex items-center gap-1.5 rounded-lg border border-line bg-slate px-2.5 py-1.5 font-sans text-[11px] font-bold text-champagne transition-colors hover:border-ash"
    >
      {children}
    </a>
  );
}

export function AboutToken({ token, symbol }: { token: TokenInfo | null; symbol: string }) {
  const [window, setWindow] = useState<WindowKey>("24h");

  /*
   * The card renders before the token resolves, and says so.
   *
   * Hiding it until the fetch lands makes the column jump by a few hundred
   * pixels every time the market changes, which is worse than a card that is
   * briefly quiet.
   */
  if (!token) {
    return (
      <section className="flex shrink-0 flex-col gap-2 rounded-2xl border border-line bg-panel p-3">
        <h2 className="font-display text-[15px] tracking-tight text-champagne">About {symbol}</h2>
        <p className="font-sans text-[11.5px] text-mute">Loading…</p>
      </section>
    );
  }

  const w = token.windows[window];

  return (
    <section className="flex shrink-0 flex-col gap-3 rounded-2xl border border-line bg-panel p-3">
      <div>
        {/*
          * NO `font-bold` ON THE DISPLAY FACE. Caacupé One ships one weight,
          * so the browser synthesises a bold by smearing the glyphs sideways —
          * which widened the "A" of "About" past its own box and clipped it
          * against the card's padding. The trap is written down in CLAUDE.md;
          * this is what it looks like when you walk into it.
          */}
        <h2 className="font-display text-[15px] tracking-tight text-champagne">
          About {token.symbol || symbol}
        </h2>
        {/*
          * Jupiter's token payload carries no description field at all, so
          * this is always the empty state today. It says which it is —
          * "no description found" is a fact about the data, and inventing a
          * sentence about somebody's coin would be worse than a blank.
          */}
        <p className="mt-0.5 font-sans text-[11.5px] text-mute">
          {token.name && token.name !== token.symbol ? token.name : "No description found"}
        </p>
      </div>

      {/* ---- the window chips ---- */}
      <div className="grid grid-cols-4 gap-1.5">
        {WINDOWS.map((k) => {
          const stat = token.windows[k];
          const change = stat?.priceChangePct ?? null;
          const on = window === k;
          return (
            <button
              key={k}
              onClick={() => setWindow(k)}
              aria-pressed={on}
              className={`flex flex-col items-center gap-0.5 rounded-lg border py-1.5 transition-colors ${
                on ? "border-line bg-raised" : "border-transparent bg-slate hover:border-line"
              }`}
            >
              <span className="font-sans text-[11px] font-bold text-champagne">{LABEL[k]}</span>
              <span
                className={`font-mono text-[10.5px] tabular-nums ${
                  change === null ? "text-mute" : change >= 0 ? "text-up" : "text-down"
                }`}
              >
                {/* "—" rather than 0.00% for a window with no history. A token
                    minted four minutes ago has not been flat for a day.
                    `pct` supplies the arrow; adding one here printed two. */}
                {pct(change)}
              </span>
            </button>
          );
        })}
      </div>

      {/* ---- who is on each side, over the selected window ---- */}
      {w ? (
        <div className="flex flex-col gap-2.5">
          <Split
            label="Trades"
            left={`${count.format(w.buys)} buys`}
            right={`${count.format(w.sells)} sells`}
            leftValue={w.buys}
            rightValue={w.sells}
          />
          <Split
            label="Volume"
            left={`${compactUsd(w.buyVolumeUsd)} vol.`}
            right={`${compactUsd(w.sellVolumeUsd)} vol.`}
            leftValue={w.buyVolumeUsd}
            rightValue={w.sellVolumeUsd}
          />
        </div>
      ) : (
        <p className="font-sans text-[11.5px] text-mute">
          Nothing recorded over {LABEL[window]} — this token may be younger than the window.
        </p>
      )}

      {/* ---- where to go and look for yourself ---- */}
      <div className="flex flex-wrap gap-1.5">
        <LinkChip href={`https://solscan.io/token/${token.mint}`}>Solscan</LinkChip>
        <LinkChip href={`https://x.com/search?q=${encodeURIComponent(token.mint)}`}>
          Search on X
        </LinkChip>
      </div>

      {/* ---- the facts with only one side ---- */}
      <dl className="divide-y divide-hairline border-t border-hairline">
        {w && <Fact label="Traders" value={count.format(w.traders)} />}
        <Fact label="Holders" value={count.format(token.holderCount)} />
        <Fact label="Liquidity" value={compactUsd(token.liquidityUsd)} />
        <Fact label="Supply" value={token.totalSupply === null ? "—" : supply(token.totalSupply)} />
      </dl>
    </section>
  );
}
