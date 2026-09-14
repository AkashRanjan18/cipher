"use client";

import { useState } from "react";

/**
 * ONE MARK PER COIN, EVERYWHERE.
 *
 * The two lists had two identity systems. Majors rendered a brand hue and a
 * unicode glyph — SOL was a green circle with ◎ — while the Solana feeds
 * rendered whatever icon Jupiter shipped. So the same coin wore two faces
 * depending on which tab you were standing in, which is the kind of thing that
 * makes a product feel assembled rather than built.
 *
 * THE RULE, in order, and the order is the whole component:
 *
 *   1. a self-hosted logo, keyed on the ticker. Byte-identical in every list,
 *      because it is literally the same file.
 *   2. the icon the token itself carries, for the hundreds of thousands of
 *      coins we will never ship a file for.
 *   3. the brand hue and glyph, for anything with neither.
 *
 * SELF-HOSTED FIRST, and not only for consistency. Resolving these through
 * Jupiter's search — the obvious shortcut — returned DOGE-1 for DOGE, a
 * 2,028-holder impostor for ADA, and a token called Y2K for DOT. That is the
 * exact failure lib/chain/tokens.ts exists to prevent, and putting a wrong
 * logo on a row is how a user ends up confident about the wrong coin. Only
 * tickers whose canonical asset was verified by hand have a file.
 */

/**
 * Tickers with a logo in public/coins, and its file name.
 *
 * A map rather than a set because the extension is not predictable: ZEC's
 * canonical mark is an SVG, and serving it as .png gives the browser a
 * content-type that does not match the bytes — which renders as nothing,
 * indistinguishable from a missing file.
 *
 * Only tickers whose canonical asset was verified by hand appear here.
 */
const SELF_HOSTED: Record<string, string> = {
  SOL: "SOL.png",
  BTC: "BTC.png",
  ETH: "ETH.png",
  BNB: "BNB.png",
  TRX: "TRX.png",
  ZEC: "ZEC.svg",
};

export function CoinMark({
  symbol,
  icon,
  hue,
  glyph,
  size = 28,
}: {
  symbol: string;
  /** The token's own icon, when it has one. */
  icon?: string | null;
  /** Brand colour for the fallback mark. */
  hue?: string;
  /** A character for the fallback mark. Defaults to the first letter. */
  glyph?: string;
  size?: number;
}) {
  /*
   * A broken image is worse than no image: it renders as a torn-page icon on
   * a dark row and reads as a bug. Remote icons rot — arweave pins expire,
   * IPFS gateways time out, a launchpad takes its CDN down — so the fallback
   * has to be reachable at runtime and not only at build time.
   */
  const [failed, setFailed] = useState(false);

  const ticker = (symbol || "").toUpperCase();
  const file = SELF_HOSTED[ticker];
  const src = failed ? null : (file ? `/coins/${file}` : (icon ?? null));

  const box = { width: size, height: size };

  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        style={box}
        onError={() => setFailed(true)}
        className="shrink-0 rounded-full bg-raised object-cover"
        loading="lazy"
      />
    );
  }

  return (
    <span
      style={{ ...box, background: hue ?? "var(--color-raised)" }}
      className={`grid shrink-0 place-items-center rounded-full font-mono text-[12px] font-bold ${
        hue ? "text-ink" : "text-ash"
      }`}
    >
      {glyph ?? (symbol || "?").slice(0, 1)}
    </span>
  );
}
