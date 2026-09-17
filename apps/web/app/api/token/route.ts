import { NextResponse } from "next/server";
import { fromJupiter, looksLikeMint, resolveToken, risks, type WindowKey } from "@/lib/chain/tokens";
import { walletsBySide, type WalletsBySide } from "@/lib/chain/wallets";

/**
 * "What is BONK?" — answered against the real Solana token list.
 *
 * Server-side because the rate limit is per-IP and a browser full of users is
 * one IP to Jupiter; because the next version of this call carries an API key;
 * and because Next's cache turns a thousand people asking about the same token
 * into one upstream request.
 *
 * The DECISION is not made here. This fetches; lib/chain/tokens.ts decides,
 * offline and under test, which is what lets the rule that rejects a $2.3M
 * impostor with two holders be verified without a network.
 */

export const dynamic = "force-dynamic";

const SEARCH = "https://lite-api.jup.ag/tokens/v2/search";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (!query || query.length > 64) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  try {
    const res = await fetch(`${SEARCH}?query=${encodeURIComponent(query)}`, {
      headers: { Accept: "application/json" },
      /*
       * Sixty seconds. Token metadata — decimals, verification, the mint
       * address — barely changes; holder counts and liquidity drift slowly.
       * The price on the ticket does NOT come from here, so a minute of
       * staleness costs nothing and collapses repeat lookups of the same
       * token into one request.
       */
      next: { revalidate: 60 },
    });
    if (!res.ok) {
      return NextResponse.json({ error: "token search unavailable" }, { status: 502 });
    }

    const raw = (await res.json()) as Record<string, unknown>[];
    const tokens = Array.isArray(raw) ? raw.map(fromJupiter) : [];
    const resolution = resolveToken(query, tokens);

    /*
     * Wallets by side, from a second vendor, and only once the token is known.
     *
     * It hangs off the RESOLVED token rather than off every candidate: the
     * search can return twenty results and nineteen of them are about to be
     * thrown away, so asking GeckoTerminal about each would be nineteen
     * requests to render one card.
     *
     * Merged rather than replacing — Jupiter still owns the price change, the
     * volumes and the trade counts, and this fills the one field it has no
     * answer for. Failure is silent: the row reads "—" and nothing else moves.
     */
    if (resolution.kind === "resolved") {
      const wallets = await walletsBySide(resolution.token.mint);
      for (const [key, w] of Object.entries(wallets) as [WindowKey, WalletsBySide][]) {
        const window = resolution.token.windows[key];
        if (window) {
          window.buyers = w.buyers;
          window.sellers = w.sellers;
        }
      }
    }

    return NextResponse.json({
      resolution,
      /* Risks ride along on a resolved token so the caller never has to make a
         second decision about whether to ask for them. */
      risks: resolution.kind === "resolved" ? risks(resolution.token) : [],
      pasted: looksLikeMint(query),
    });
  } catch (e) {
    console.error("[cipher] token search failed:", e);
    return NextResponse.json({ error: "token search unavailable" }, { status: 502 });
  }
}
