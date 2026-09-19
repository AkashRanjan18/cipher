import {
  QuoteError,
  USDC_MINT,
  fromBaseUnits,
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
 * same `otherAmountThreshold`. The paper fill stops being a simulation and
 * becomes a DRY RUN: identical in every respect to the real thing except that
 * nothing is signed.
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
  /** The live market price, USD per token — the second impact reference. */
  mark?: number;
}

/**
 * Quote one fill.
 *
 * Throws `QuoteError` when there is no route, which the callers already know
 * how to render: the seam turns it into a `failed` outcome that retries, and a
 * token with no liquidity path is a fact about the market rather than a bug.
 */
export async function quoteFill(req: FillRequest): Promise<QuotedFill> {
  const { mint, decimals, side, size, slippageBps, signal, mark } = req;
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
      /*
       * NO platformFeeBps. THE FEE IS CHARGED ONCE, BY THE LEDGER.
       *
       * This asked for it, and `quote()` in paper.ts then ran `feeFor()` over
       * the result — so every signed-in trade paid cipher's commission twice.
       * A $500 SOL buy came out 1.04% above mid instead of 0.54%, which is why
       * a position opened at a $97.00 mark showed a cost basis of $97.92. The
       * signed-out path never had the bug, because it prices from the model
       * rather than from a quote, so the two paths disagreed about what the
       * same trade cost.
       *
       * `feeFor` is the one that has to survive, because it carries the $0.95
       * floor under $200 of notional and basis points cannot express a floor.
       * What comes back from here is therefore the raw market price, and the
       * commission is added on top exactly where the refusals and the balance
       * already read it from.
       *
       * cipher: when the relayer lands, the fee moves on-chain and IS
       * platformFeeBps plus a fee account. At that point this comes back and
       * `feeFor` becomes the floor top-up, not the whole charge.
       */
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

  /*
   * IMPACT, MEASURED — never read off Jupiter's `priceImpactPct`.
   *
   * Found live, 19 Sep 2026: a $500 ZCAT buy was refused as "moves the price
   * about 6.70%" on a $110M coin with $1.5M of liquidity. Jupiter returned
   * priceImpactPct 0.028 for $500 and 0.039 for $50,000 — a field that barely
   * moves with 100x the size is not an impact, and multiplying it by 100
   * refused real trades. Measured directly the same day, $500 paid 0.51% more
   * per token than $1 did.
   *
   * THE REFERENCE IS A SMALL QUOTE, TAKEN NOW, ON THE SAME PAIR — 1% of
   * the order's size. Same moment, same pools, same fees, so they cancel and
   * what is left is what this order does to the price. Two audits of every
   * token on cipher (19 Sep 2026) chose this over the alternatives:
   *   - the listed market price lags the pools by several percent on
   *     memecoins, and read ZCAT at 7.6% and OPENAI at 50% for a $500 buy
   *   - a reference at 0.1% of the size ($0.50) routed through a dust pool
   *     on CDOG and read 695%; at 1% it stays on the real route
   * The listed price stands in only if the reference quote fails.
   */
  let impactBps = 0;
  const ratio = (paid: number, ref: number) =>
    Math.max(0, Math.round((buying ? paid / ref - 1 : 1 - paid / ref) * 10_000));
  try {
    const refIn = Math.max(1, Math.floor(Number(toBaseUnits(size, inDecimals)) / 100));
    const ref = await quote({ inputMint, outputMint, amount: String(refIn), slippageBps }, signal);
    const rIn = fromBaseUnits(ref.inAmount, inDecimals);
    const rOut = fromBaseUnits(ref.outAmount, outDecimals);
    if (rIn > 0 && rOut > 0) impactBps = ratio(price, buying ? rIn / rOut : rOut / rIn);
    else if (mark && mark > 0) impactBps = ratio(price, mark);
  } catch {
    if (mark && mark > 0) impactBps = ratio(price, mark);
  }

  return {
    price,
    qty,
    minOut,
    impactBps,
    route: q.route.map((r) => r.label).join(" > ") || "direct",
  };
}
