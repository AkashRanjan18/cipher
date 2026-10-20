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
const PRO = "https://api.jup.ag";

/*
 * THE KEY IS USED WHEN THERE IS ONE, as prices.ts already does. Quotes went
 * to the keyless host regardless, so every stop the worker fired spent two
 * calls from the same small shared allowance as the public /api/quote — and
 * in a sell-off, the one minute that matters, the 429s arrived first.
 */
function host(): { base: string; headers: Record<string, string> } {
  const key = process.env.JUPITER_API_KEY;
  return key
    ? { base: PRO, headers: { Accept: "application/json", "x-api-key": key } }
    : { base: BASE, headers: { Accept: "application/json" } };
}

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
  /**
   * The wallet that would sign this swap. REQUIRED BY V2, even to quote.
   *
   * It decides which token accounts exist and therefore what setup the swap
   * needs, so a quote taken against the wrong taker can miss the rent for a
   * first-time token account. Every path that can know the wallet passes it;
   * QUOTE_TAKER stands in for the ones that cannot — a preview on the landing
   * page, a signed-out visitor, the impact audit.
   */
  taker?: string;
  /** The token account cipher's fee lands in. Needed only when fee > 0. */
  feeAccount?: string;
}

/**
 * The stand-in taker for a quote nobody will sign.
 *
 * cipher's own devnet signer, which exists on mainnet as an address and holds
 * nothing. A quote needs *a* wallet to reason about token accounts; using one
 * address consistently keeps those quotes comparable with each other, which
 * matters for the impact audit more than for any single number on screen.
 */
export const QUOTE_TAKER = "CptjnLFeUDNaUdXKoHVGKTVidyPqTKmmWuZtKQ2tF7aK";

export class QuoteError extends Error {
  /*
   * DECLARED AND ASSIGNED, not a constructor parameter property.
   *
   * `constructor(message: string, readonly status: number)` is valid
   * TypeScript and is NOT valid stripped JavaScript — it is one of the few
   * constructs that emits code rather than only erasing types. The suite runs
   * on `node --experimental-strip-types`, so this file was unimportable by any
   * test the moment anything under test reached it:
   *
   *   ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX: TypeScript parameter property is not
   *   supported in strip-only mode
   *
   * It went unnoticed for as long as nothing tested imported Jupiter.
   */
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "QuoteError";
    this.status = status;
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
    taker: req.taker ?? QUOTE_TAKER,
  });
  if (req.platformFeeBps) params.set("platformFeeBps", String(req.platformFeeBps));
  if (req.feeAccount) params.set("feeAccount", req.feeAccount);

  const { base, headers } = host();
  /*
   * SWAP V2 /build — the Router path, and the cheap one.
   *
   * V2 offers two doors and they do not cost the same. `/order` hands back a
   * finished transaction and is less code, but it adds Jupiter's own platform
   * fee on top of cipher's: 10 bps on an ordinary pair and FIFTY on a token
   * less than a day old, which is the only kind of token this product is
   * really for. `/build` charges no Jupiter swap fee and takes cipher's
   * platformFeeBps straight, at the price of assembling the transaction here.
   * The user's rule (least total cost, 19 Sep 2026) decides it.
   *
   * It also returns what the signing path needs — instructions, the lookup
   * tables and a blockhash — so one call serves both the quote and the trade.
   */
  const res = await fetch(`${base}/swap/v2/build?${params}`, { headers, signal });

  if (!res.ok) {
    /*
     * A 400 here is usually "no route" — a token with no liquidity path to
     * SOL — which is a fact about the market rather than a bug, and the user
     * needs to hear it as one.
     */
    const body = await res.text().catch(() => "");
    throw new QuoteError(
      res.status === 400
        ? "This token can't be traded yet — no market can fill it right now."
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
      const s = step as Record<string, unknown>;
      const info = s.swapInfo as Record<string, unknown> | undefined;
      /* V2 reports a split as `bps` where V1 said `percent`. Both are read
         here because a route that silently showed 0% everywhere would look
         like a broken display rather than a changed field. */
      const bps = s.bps === undefined ? null : Number(s.bps);
      return {
        label: String(info?.label ?? "pool"),
        percent: bps === null ? Number(s.percent ?? 0) : bps / 100,
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
