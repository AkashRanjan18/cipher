/**
 * Jupiter: routes, quotes, and the line where the commission actually happens.
 *
 * Jupiter is not a venue and holds nothing. A Solana token's liquidity sits in
 * public pools — Raydium, Orca, Meteora — and anyone can trade against them by
 * sending a transaction. What Jupiter does is find the path: which pools, in
 * what order, split how. Nobody grants access to a token; the pools are simply
 * there.
 *
 * `platformFeeBps` and `feeAccount` are how the 0.5% reaches cipher. The take
 * rate is a PARAMETER ON THE SWAP, not something invoiced afterwards — which
 * is also why it is impossible to charge someone a fee on a trade that did not
 * happen.
 */

/** Free and keyless. `api.jup.ag` is the same surface with a key and higher limits. */
const BASE = "https://lite-api.jup.ag";

/** Wrapped SOL. The mint every route is priced against. */
export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/** 0.5% with a referral code, as the commission model states. */
export const PLATFORM_FEE_BPS = 50;

export interface Quote {
  inputMint: string;
  outputMint: string;
  /** Base units of the input. A string because uint64 overflows a JS number. */
  inAmount: string;
  outAmount: string;
  /** The floor the swap will not fill below — minimumOutAmount, in effect. */
  otherAmountThreshold: string;
  /** How far this order alone moves the price. "0.0123" is 1.23%. */
  priceImpactPct: string;
  slippageBps: number;
  /** Which pools, in order. Shown so a route is inspectable rather than magic. */
  route: { label: string; percent: number }[];
  /** The whole payload, needed verbatim to build the swap. Never rebuilt by hand. */
  raw: unknown;
}

export interface QuoteRequest {
  inputMint: string;
  outputMint: string;
  /** Base units of the INPUT token, as an integer string. */
  amount: string;
  slippageBps: number;
  /** Omit to quote without cipher's fee — useful for comparing. */
  platformFeeBps?: number;
}

export class QuoteError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "QuoteError";
  }
}

/**
 * Ask what a swap would actually cost.
 *
 * Read-only. No signature, no key, nothing moves. This is the call that turns
 * "buy $500 of BONK" from a sentence into a number a person can check, and it
 * works today against real liquidity.
 */
export async function quote(req: QuoteRequest, signal?: AbortSignal): Promise<Quote> {
  const params = new URLSearchParams({
    inputMint: req.inputMint,
    outputMint: req.outputMint,
    amount: req.amount,
    slippageBps: String(req.slippageBps),
    swapMode: "ExactIn",
  });
  if (req.platformFeeBps) params.set("platformFeeBps", String(req.platformFeeBps));

  const res = await fetch(`${BASE}/swap/v1/quote?${params}`, {
    headers: { Accept: "application/json" },
    signal,
  });

  if (!res.ok) {
    /*
     * A 400 here is usually "no route" — a token with no liquidity path to
     * SOL — which is a fact about the market rather than a bug, and the user
     * needs to hear it as one.
     */
    const body = await res.text().catch(() => "");
    throw new QuoteError(
      res.status === 400
        ? "No route for that trade. The token may have no liquidity paired with SOL."
        : `Jupiter returned ${res.status}. ${body.slice(0, 120)}`,
      res.status,
    );
  }

  const raw = (await res.json()) as Record<string, unknown>;
  const plan = Array.isArray(raw.routePlan) ? raw.routePlan : [];

  return {
    inputMint: String(raw.inputMint ?? req.inputMint),
    outputMint: String(raw.outputMint ?? req.outputMint),
    inAmount: String(raw.inAmount ?? req.amount),
    outAmount: String(raw.outAmount ?? "0"),
    otherAmountThreshold: String(raw.otherAmountThreshold ?? "0"),
    priceImpactPct: String(raw.priceImpactPct ?? "0"),
    slippageBps: typeof raw.slippageBps === "number" ? raw.slippageBps : req.slippageBps,
    route: plan.map((step) => {
      const info = (step as Record<string, unknown>).swapInfo as Record<string, unknown> | undefined;
      return {
        label: String(info?.label ?? "pool"),
        percent: Number((step as Record<string, unknown>).percent ?? 0),
      };
    }),
    raw,
  };
}

/**
 * Base units ↔ human units.
 *
 * KEPT AS STRINGS ON THE WAY IN. A uint64 of lamports exceeds what a JS number
 * represents exactly, and a rounding error here is not a display bug — it is
 * the amount that gets swapped. Converting for display is fine; converting to
 * build a transaction is not.
 */
export function toBaseUnits(amount: number, decimals: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return "0";
  return BigInt(Math.round(amount * 10 ** decimals)).toString();
}

export function fromBaseUnits(amount: string, decimals: number): number {
  const n = Number(amount);
  return Number.isFinite(n) ? n / 10 ** decimals : 0;
}

/** Price impact as a percentage, for the readback. */
export function impactPct(q: Quote): number {
  const n = Number(q.priceImpactPct);
  return Number.isFinite(n) ? n * 100 : 0;
}

/**
 * What one unit of output costs, in input units.
 *
 * The number a person recognises as "the price" — not the raw amounts, and
 * not what the chart says, because this one includes the route.
 */
export function effectivePrice(q: Quote, inDecimals: number, outDecimals: number): number {
  const inAmt = fromBaseUnits(q.inAmount, inDecimals);
  const outAmt = fromBaseUnits(q.outAmount, outDecimals);
  return outAmt > 0 ? inAmt / outAmt : 0;
}
