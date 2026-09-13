import { NextResponse } from "next/server";
import {
  PLATFORM_FEE_BPS,
  QuoteError,
  SOL_MINT,
  effectivePrice,
  fromBaseUnits,
  impactPct,
  quote,
  toBaseUnits,
} from "@/lib/chain/jupiter";
import { fromJupiter, resolveToken, risks } from "@/lib/chain/tokens";

/**
 * What a real swap would actually cost, against real liquidity, right now.
 *
 * READ ONLY. Nothing is signed, nothing moves, no key is involved. This is the
 * call that turns "buy $500 of BONK" from a sentence into numbers a person can
 * check before anything exists that could spend their money — and it works
 * today, on mainnet, for any token with a pool.
 *
 * It is deliberately the step BEFORE the relayer. Quoting is safe and free;
 * signing is neither. Building this first means the readback can show a true
 * price, a true route and a true fee long before cipher can execute one.
 */

export const dynamic = "force-dynamic";

const SEARCH = "https://lite-api.jup.ag/tokens/v2/search";

/** A sentence's default, from packages/shared. 3%. */
const DEFAULT_SLIPPAGE_BPS = 300;

async function lookup(query: string) {
  const res = await fetch(`${SEARCH}?query=${encodeURIComponent(query)}`, {
    headers: { Accept: "application/json" },
    next: { revalidate: 60 },
  });
  if (!res.ok) return null;
  const raw = (await res.json()) as Record<string, unknown>[];
  return Array.isArray(raw) ? raw.map(fromJupiter) : [];
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const token = params.get("token")?.trim() ?? "";
  const usd = Number(params.get("usd") ?? "0");
  const solPrice = Number(params.get("solPrice") ?? "0");
  const slippageBps = Number(params.get("slippageBps") ?? DEFAULT_SLIPPAGE_BPS);

  if (!token || !(usd > 0) || !(solPrice > 0)) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  try {
    const tokens = await lookup(token);
    if (!tokens) {
      return NextResponse.json({ error: "token search unavailable" }, { status: 502 });
    }

    /*
     * RESOLVE BEFORE QUOTING, always.
     *
     * Quoting first and resolving after would price a route into whichever
     * mint the search happened to return — which, for "BONK", is a token with
     * two holders and manufactured liquidity. A quote against the wrong mint
     * is a confident, precise, wrong number, which is worse than no number.
     */
    const resolution = resolveToken(token, tokens);
    if (resolution.kind !== "resolved") {
      return NextResponse.json({ resolution });
    }

    const t = resolution.token;

    /*
     * Priced in SOL, because that is what the user holds and what every route
     * is quoted against. The dollar figure is the user's unit; SOL is the
     * chain's. Converting here keeps that conversion in one place.
     */
    const solIn = usd / solPrice;
    const q = await quote({
      inputMint: SOL_MINT,
      outputMint: t.mint,
      amount: toBaseUnits(solIn, 9),
      slippageBps,
      platformFeeBps: PLATFORM_FEE_BPS,
    });

    const outTokens = fromBaseUnits(q.outAmount, t.decimals);
    const minOut = fromBaseUnits(q.otherAmountThreshold, t.decimals);

    return NextResponse.json({
      resolution,
      risks: risks(t),
      quote: {
        solIn,
        usdIn: usd,
        outTokens,
        /* The floor the swap will not fill below. On chain this IS the
           minimumOutAmount — the thing that makes a limit order a limit order
           rather than a delayed market order. */
        minOutTokens: minOut,
        pricePerToken: effectivePrice(q, 9, t.decimals) * solPrice,
        impactPct: impactPct(q),
        route: q.route,
        feeUsd: (usd * PLATFORM_FEE_BPS) / 10_000,
        slippageBps: q.slippageBps,
      },
    });
  } catch (e) {
    if (e instanceof QuoteError) {
      /*
       * "No route" is a fact about the market, not a failure. 200 with the
       * reason, so the client renders a sentence rather than an error state.
       */
      return NextResponse.json({ error: e.message, kind: "noRoute" });
    }
    console.error("[cipher] quote failed:", e);
    return NextResponse.json({ error: "quote unavailable" }, { status: 502 });
  }
}
