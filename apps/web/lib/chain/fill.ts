import {
  PLATFORM_FEE_BPS,
  QuoteError,
  USDC_MINT,
  fromBaseUnits,
  impactPct,
  quote,
  toBaseUnits,
} from "./jupiter.ts";

/**
 * What a trade would ACTUALLY fill at, through a real route.
 *
 * The paper ledger has been inventing this number. `fillPrice()` in paper.ts
 * charges ten basis points of spread plus a first-order impact model — a fair
 * approximation for SOL and nonsense for a memecoin, where $500 into a pool
 * with three thousand dollars of liquidity moves the price several percent.
 * So every paper P&L has been quietly wrong, and wrong by more the further you
 * get from the majors, which is exactly where cipher is meant to live.
 *
 * This asks Jupiter instead. Same endpoint the real swap will use, same route,
 * same `platformFeeBps`, same `otherAmountThreshold`. The paper fill stops
 * being a simulation and becomes a DRY RUN: identical in every respect to the
 * real thing except that nothing is signed.
 *
 * QUOTED AGAINST USDC, not SOL, because that is what the ledger holds. Routing
 * a dollar figure through SOL to reach a token adds a second leg that the
 * account never takes, and its price impact would be charged to a user who
 * never made that trade.
 */

/** USDC has six decimals. Hardcoded because it is a property of that mint. */
const USDC_DECIMALS = 6;

export interface QuotedFill {
  /** USD per unit of the token, for THIS size, through this route. */
  price: number;
  /**
   * Units of the token the trade moves.
   *
   * May differ from what was asked for. A dollar-denominated buy is quoted by
   * spending exactly that many dollars, so the token amount is whatever the
   * route returns — which is the honest answer, and the one a real swap gives.
   */
  qty: number;
  /** What the swap would refuse to fill below, in the output unit. */
  minOut: number;
  /** How far this order alone moves the price, in bps. */
  impactBps: number;
  route: string;
}

export interface FillRequest {
  mint: string;
  decimals: number;
  side: "buy" | "sell";
  /** DOLLARS for a buy, token units for a sell. */
  size: number;
  slippageBps: number;
  signal?: AbortSignal;
}

/**
 * Quote one fill.
 *
 * Throws `QuoteError` when there is no route, which the callers already know
 * how to render: the seam turns it into a `failed` outcome that retries, and a
 * token with no liquidity path is a fact about the market rather than a bug.
 */
export async function quoteFill(req: FillRequest): Promise<QuotedFill> {
  const { mint, decimals, side, size, slippageBps, signal } = req;
  if (!(size > 0)) throw new QuoteError("That is not an amount.", 400);

  /*
   * DIRECTION DECIDES WHICH SIDE IS THE INPUT, and the input is what gets
   * spent exactly. Jupiter quotes ExactIn, so whichever amount the user named
   * is the one that comes out precise — dollars on a buy, tokens on a sell.
   * That matches what people mean: "buy $500" should spend $500, and "sell my
   * 12 BONK" should sell twelve.
   */
  const buying = side === "buy";
  const inputMint = buying ? USDC_MINT : mint;
  const outputMint = buying ? mint : USDC_MINT;
  const inDecimals = buying ? USDC_DECIMALS : decimals;
  const outDecimals = buying ? decimals : USDC_DECIMALS;

  const q = await quote(
    {
      inputMint,
      outputMint,
      amount: toBaseUnits(size, inDecimals),
      slippageBps,
      /* cipher's cut, quoted in — so the price the ledger records is the
         price after the fee the user will actually pay. */
      platformFeeBps: PLATFORM_FEE_BPS,
    },
    signal,
  );

  const inAmt = fromBaseUnits(q.inAmount, inDecimals);
  const outAmt = fromBaseUnits(q.outAmount, outDecimals);
  const minOut = fromBaseUnits(q.otherAmountThreshold, outDecimals);

  if (!(outAmt > 0)) {
    throw new QuoteError("That route returns nothing. The pool may be empty.", 400);
  }

  /*
   * Price is always USD per TOKEN, whichever way round the swap went. On a buy
   * the dollars are the input and the tokens the output; on a sell it is the
   * reverse. Getting this backwards inverts the cost basis, which is the kind
   * of error that looks like a 10,000% gain.
   */
  const price = buying ? inAmt / outAmt : outAmt / inAmt;
  const qty = buying ? outAmt : inAmt;

  return {
    price,
    qty,
    minOut,
    impactBps: Math.round(impactPct(q) * 100),
    route: q.route.map((r) => r.label).join(" > ") || "direct",
  };
}
