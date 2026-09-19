import type { Amount, ExitRule, OrderSpec, Trigger } from "@cipher/shared";

/**
 * The safety layer.
 *
 * Every compiled order passes through here, from BOTH paths. The grammar can
 * produce nonsense as easily as a model can — it is a set of regexes, and a
 * regex that matches is not a regex that understood.
 *
 * Pure and offline. No account context is fetched here; it is passed in. That
 * is what makes the whole file testable without a browser, a wallet or a
 * network, and the money rules are exactly the rules that have to be testable.
 *
 * WHAT THIS IS NOT: it does not decide anything. It reports. The compiler
 * transcribes, this checks, the user approves, the executor acts — and keeping
 * those four separate is the reason cipher can say it never exercises
 * discretion on a user's behalf.
 */

export type Severity = "error" | "warning";

export interface Problem {
  severity: Severity;
  /**
   * Which part of the order. The readback renders line by line, so the UI can
   * mark the offending line rather than dumping a list at the bottom where it
   * is not obviously attached to anything.
   */
  at: "entry" | "slippage" | "token" | "exits" | `exit:${string}`;
  /** Shown verbatim. Say what is wrong and what would fix it. */
  message: string;
}

export interface ValidationContext {
  /** Spendable cash in USD. */
  cashUsd: number;
  /** Units of the open market currently held. 0 when flat. */
  position: number;
  /** Live price. Null when unknown — checks that need it are skipped, not guessed. */
  price: number | null;
}

/*
 * Slippage ceilings.
 *
 * 10% is where a reasonable memecoin order stops being reasonable; above 50%
 * you are not setting a tolerance, you are agreeing to be robbed, and the
 * number is almost always a typo (500 meaning 5.00%).
 */
const SLIPPAGE_WARN_BPS = 1_000;
const SLIPPAGE_MAX_BPS = 5_000;

const money = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

/** The size an amount resolves to, in USD, or null when it cannot be known yet. */
function usdValue(a: Amount, ctx: ValidationContext): number | null {
  switch (a.kind) {
    case "usd":
      return a.value;
    case "tokens":
      return ctx.price === null ? null : a.value * ctx.price;
    case "percentOfPosition":
      return ctx.price === null ? null : ctx.position * ctx.price * (a.value / 100);
  }
}

/**
 * Checks that apply to any amount, anywhere.
 *
 * Percentages above 100 are the interesting case: a single rule asking for
 * 140% of something is a misparse, and letting it through means arming a rule
 * whose readback reads as nonsense. A LADDER that sums past 100 is checked in
 * checkExits, because it is only visible across rules.
 */
function checkAmount(a: Amount, at: Problem["at"]): Problem[] {
  const out: Problem[] = [];
  if (!Number.isFinite(a.value) || a.value <= 0) {
    out.push({ severity: "error", at, message: "That is not an amount." });
    return out;
  }
  if (a.kind === "percentOfPosition" && a.value > 100) {
    out.push({
      severity: "error",
      at,
      message: `You cannot sell ${a.value}% of a position. The most is everything.`,
    });
  }
  return out;
}

/** Triggers that are arithmetically impossible, rather than merely unwise. */
function checkTrigger(t: Trigger, at: Problem["at"]): Problem[] {
  switch (t.kind) {
    case "priceMultiple":
      /* 1x is your entry and below it is a loss. Someone typing "take profit
         at 0.8x" has inverted a stop, and arming it as a take-profit would
         sell them out at a loss while the readback said "profit". */
      return t.value > 1
        ? []
        : [
            {
              severity: "error",
              at,
              message: `${t.value}× is at or below your entry, so it is not a profit. Did you mean a stop?`,
            },
          ];

    case "drawdownFromEntry":
      return t.percent > 0 && t.percent < 100
        ? []
        : [
            {
              severity: "error",
              at,
              message: "A stop has to be between 0% and 100% below your entry.",
            },
          ];

    case "trailingStop":
      return t.percent > 0 && t.percent < 100
        ? []
        : [
            {
              severity: "error",
              at,
              message: "A trailing stop has to be between 0% and 100% off the high.",
            },
          ];

    case "priceAbsolute":
      return t.value > 0
        ? []
        : [{ severity: "error", at, message: "That is not a price." }];

    case "duration":
      return t.seconds > 0
        ? []
        : [{ severity: "error", at, message: "That is not a length of time." }];

    case "timeAbsolute":
      return Number.isFinite(Date.parse(t.iso))
        ? []
        : [{ severity: "error", at, message: "That is not a time I can read." }];
  }
}

/**
 * Exits that contradict or shadow each other.
 *
 * Both are warnings rather than errors, deliberately: neither is impossible,
 * and refusing an order because it is unusual is how a tool starts arguing
 * with a trader. They belong in the readback, where the user can see them and
 * decide.
 */
function checkExitSet(exits: ExitRule[]): Problem[] {
  const out: Problem[] = [];

  const stops = exits.filter((e) => e.trigger.kind === "drawdownFromEntry");
  const trails = exits.filter((e) => e.trigger.kind === "trailingStop");

  if (stops.length && trails.length) {
    out.push({
      severity: "warning",
      at: "exits",
      message:
        "You have a fixed stop and a trailing stop on the same position. Whichever is hit first wins; the other never fires.",
    });
  }

  /*
   * A stop that can never be reached.
   *
   * Two fixed stops, and if the shallower one sells everything, the deeper one
   * is dead code — the position is already flat by the time price gets there.
   * Worth saying, because it usually means the user meant a ladder and wrote
   * two whole-position exits.
   */
  const whole = stops.filter(
    (e) => e.amount.kind === "percentOfPosition" && e.amount.value === 100,
  );
  if (whole.length > 1) {
    out.push({
      severity: "warning",
      at: "exits",
      message:
        "Two stops each sell the whole position, so only the first one can ever fire.",
    });
  }

  /*
   * A LADDER THAT SELLS MORE THAN YOU HOLD.
   *
   * Percentages are frozen into tokens when the order is placed (19 Sep
   * 2026) — "half at 2x, half at 3x, half at 4x" is 150% of the position, not
   * the 87.5% it was when each half was taken of whatever was left. A sell
   * never executes short, so the last rung waits for tokens that will not be
   * there. A warning, not a refusal: it does no harm, and buying more would
   * wake it. Only targets are summed — a stop and a target are alternatives,
   * and both selling everything is the normal case.
   */
  const laddered = exits
    .filter((e) => e.trigger.kind === "priceMultiple" && e.amount.kind === "percentOfPosition")
    .reduce((sum, e) => sum + e.amount.value, 0);
  if (laddered > 100) {
    out.push({
      severity: "warning",
      at: "exits",
      message: `Your targets add up to ${laddered}% of the position, so the last one needs more than you will hold and waits until you do.`,
    });
  }

  /* Two rules at the identical level is almost always a duplicate from a
     re-parse, not an intention. */
  const seen = new Set<string>();
  for (const e of exits) {
    const key = JSON.stringify(e.trigger);
    if (seen.has(key)) {
      out.push({
        severity: "warning",
        at: `exit:${e.id}`,
        message: "This fires at the same level as an earlier rule.",
      });
    }
    seen.add(key);
  }

  return out;
}

/**
 * Validate one compiled order against the account.
 *
 * Returns every problem rather than the first, because a readback showing one
 * error, then another after it is fixed, then a third, is how a user gives up
 * on a sentence they could have corrected in one go.
 */
/**
 * A price more than this far from the market is asked about, never armed.
 *
 * Half. Found live, 19 Sep 2026: "a target price of one twenty dollars" was
 * read as $21 with SOL at $112 — a target the user placed above the market
 * armed 81% below it. Whoever misreads a number, the parser or the model, the
 * number itself gives the mistake away. A real order that far out is rare
 * enough that asking costs nothing, and it can always be said as a
 * percentage ("stop at -60%"), which this does not question.
 */
const FAR_FROM_MARKET = 0.5;

function checkPricesNearMarket(spec: OrderSpec, ctx: ValidationContext): Problem[] {
  if (ctx.price === null || !(ctx.price > 0)) return [];
  const out: Problem[] = [];
  const market = ctx.price;
  const far = (p: number) => Math.abs(p - market) / market > FAR_FROM_MARKET;
  const pct = (p: number) => `${Math.round((Math.abs(p - market) / market) * 100)}%`;
  const side = (p: number) => (p < market ? "below" : "above");

  const limit = spec.entry?.trigger?.kind === "priceAbsolute" ? spec.entry.trigger.value : null;

  /*
   * NO BUY STOPS. The user's call, 19 Sep 2026: a buy limit is at the price
   * or BELOW, and cipher does not offer a buy that waits for the price to
   * rise. "Buy $100 of SOL at $130" with SOL at $112 used to rest as a
   * breakout buy; now it is refused, with the two things it could have meant.
   */
  if (spec.entry?.side === "buy" && limit !== null && limit > market) {
    out.push({
      severity: "error",
      at: "entry",
      message: `A buy limit has to be below the current price (${money(market)}), and ${money(limit)} is above it. Say a lower price, or buy now at the market.`,
    });
  }
  if (limit !== null && far(limit)) {
    out.push({
      severity: "error",
      at: "entry",
      message: `${money(limit)} is ${pct(limit)} ${side(limit)} the price (${money(market)}) — I didn't place it. Say the price you meant.`,
    });
  }

  for (const e of spec.exits) {
    if (e.trigger.kind !== "priceAbsolute") continue;
    const p = e.trigger.value;
    if (!far(p)) continue;
    out.push({
      severity: "error",
      at: `exit:${e.id}`,
      message: `${money(p)} is ${pct(p)} ${side(p)} the price (${money(market)}) — I didn't set it. Say the price you meant, or use a percentage like "stop at -60%".`,
    });
  }
  return out;
}

export function validateOrder(spec: OrderSpec, ctx: ValidationContext): Problem[] {
  const out: Problem[] = [];
  const { entry, exits } = spec;

  if (entry) {
    out.push(...checkAmount(entry.amount, "entry"));

    /*
     * A PERCENTAGE OF A POSITION IS NOT A BUY SIZE.
     *
     * "Buy half at $95" parses — "half" is a valid amount and $95 is a valid
     * limit — and then means nothing: half of a position you do not hold yet.
     * Without this it rested, fired a minute later when the price arrived,
     * failed to resolve a size, retried three times and died. The user found
     * out long after the price had moved, from a history row reading "could
     * not resolve the size".
     *
     * A SELL is the opposite and stays legal: "sell half" is half of what you
     * hold, which is exactly what percentOfPosition means.
     *
     * An error, not a warning — no reading of the sentence works.
     */
    if (entry.side === "buy" && entry.amount.kind === "percentOfPosition") {
      const said = entry.amount.value === 100 ? "everything" : `${entry.amount.value}%`;
      out.push({
        severity: "error",
        at: "entry",
        message: `"${said}" isn't a buy size — I don't know what it's a percentage of. Say a dollar amount or a number of tokens.`,
      });
    }

    /* Unresolved token. A warning while compiling and an ERROR at arm time —
       this function does not know which, so it reports and the caller decides.
       Arming against a null mint would buy nothing, or worse, something else. */
    if (!entry.mint) {
      out.push({
        severity: "warning",
        at: "token",
        message: `I have not resolved "${entry.token}" to a specific token yet.`,
      });
    }

    if (entry.slippageBps > SLIPPAGE_MAX_BPS) {
      out.push({
        severity: "error",
        at: "slippage",
        message: `${(entry.slippageBps / 100).toFixed(1)}% slippage is not a tolerance, it is an invitation. Did you mean ${(entry.slippageBps / 10000).toFixed(2)}%?`,
      });
    } else if (entry.slippageBps > SLIPPAGE_WARN_BPS) {
      out.push({
        severity: "warning",
        at: "slippage",
        message: `${(entry.slippageBps / 100).toFixed(1)}% slippage is wide. On a thin pool that is what you will pay.`,
      });
    }

    /* Affordability. THE reason this function takes an account and the
       compiler does not: deciding what someone can afford is a judgement, and
       it belongs in deterministic code the user can audit, not in a model. */
    if (entry.side === "buy") {
      const cost = usdValue(entry.amount, ctx);
      if (cost !== null && cost > ctx.cashUsd) {
        out.push({
          severity: "error",
          at: "entry",
          message: `That needs ${money(cost)} and you have ${money(ctx.cashUsd)}.`,
        });
      }
    }

    if (entry.side === "sell" && ctx.position <= 0) {
      out.push({
        severity: "error",
        at: "entry",
        message: "You have nothing to sell in this market.",
      });
    }

    if (entry.side === "sell" && entry.amount.kind === "tokens" && entry.amount.value > ctx.position) {
      out.push({
        severity: "error",
        at: "entry",
        message: `You hold ${ctx.position} and that sells ${entry.amount.value}.`,
      });
    }
  }

  for (const e of exits) {
    out.push(...checkAmount(e.amount, `exit:${e.id}`));
    out.push(...checkTrigger(e.trigger, `exit:${e.id}`));
  }

  out.push(...checkPricesNearMarket(spec, ctx));

  out.push(...checkExitSet(exits));

  /*
   * Exits with nothing to attach to.
   *
   * Checked last, because it is a statement about the order as a whole rather
   * than about any line in it. An exit is allowed to reference a position that
   * does not exist YET — it binds to the entry's fill — but with no entry and
   * no holding there is nothing for it to ever fire against.
   */
  if (!entry && exits.length > 0 && ctx.position <= 0) {
    out.push({
      severity: "error",
      at: "exits",
      message: "You have no position in this market for these exits to sell.",
    });
  }

  if (!entry && exits.length === 0) {
    out.push({
      severity: "error",
      at: "entry",
      message: "There is no order here.",
    });
  }

  return out;
}

/** Convenience: does anything block arming? Warnings never do. */
export function blocks(problems: Problem[]): boolean {
  return problems.some((p) => p.severity === "error");
}
