import type { Interval } from "./market.ts";
import type { OrderSpec } from "./order.ts";

/**
 * What Sana is allowed to do.
 *
 * This union IS the boundary. The prompt bar can do exactly what the UI can
 * do and nothing else — no web search, no external lookups, no general
 * questions — and that rule is enforced HERE, in the type system, rather than
 * in a prompt.
 *
 * The difference matters. A model told "only answer trading questions" will
 * eventually answer something else, because instructions are advisory. A model
 * handed this union as its output schema cannot return a web search, because
 * there is no field to put one in. The boundary holds even when the prompt
 * fails, and it holds identically for the grammar path, which has no prompt at
 * all.
 *
 * It is also the cost control. Inference is cheap — a compile is a fraction of
 * a cent. What is expensive is per-query search and token-data APIs, where the
 * user decides how many calls you pay for. None of that is reachable from
 * here.
 *
 * ADDING A CAPABILITY means adding a member to this union, which means every
 * switch downstream stops compiling until it is handled. That is deliberate:
 * a new thing Sana can do should be impossible to add without deciding what
 * the validator, the readback and the UI do about it.
 */

export const INTENT_VERSION = 1;

/**
 * Place a trade, or arm exits against a position.
 *
 * The only kind that moves money, and the only one that has to pass through a
 * readback the user approves before anything happens. Everything else here is
 * reversible by looking at the screen.
 */
export interface OrderIntent {
  kind: "order";
  spec: OrderSpec;
}

/**
 * Change what the terminal is looking at.
 *
 * Deliberately not "open a URL" — a closed set of the things the UI itself can
 * switch between, so an unknown market or interval fails at compile rather
 * than producing a navigation to nowhere.
 */
export interface NavigateIntent {
  kind: "navigate";
  /** A Binance pair from MARKETS. Validated against the allowlist, never trusted. */
  symbol?: string;
  interval?: Interval;
  panel?: "alerts" | "tokens" | "leaders" | "feed";
}

/**
 * Read something already on screen.
 *
 * Every one of these is answerable from state the client ALREADY holds — the
 * account, the loaded candles, the poll that feeds the market list. None of
 * them is allowed to trigger a fetch, which is the whole point: a question can
 * never cost money.
 *
 * If a question needs data cipher does not have, it is a refusal, not a query.
 */
export interface QueryIntent {
  kind: "query";
  subject:
    /** What you hold, and what it is worth. */
    | "position"
    /** Spendable cash. */
    | "cash"
    /** Cash plus holdings, marked at the live price. */
    | "equity"
    /** Realised, unrealised, or both. */
    | "pnl"
    /** Your fill history. */
    | "fills"
    /** Price, market cap, 24h change, volume, liquidity for the open market. */
    | "market"
    /** Fees paid so far. */
    | "fees";
  /** Narrows a query to one market. Defaults to whatever is open. */
  symbol?: string;
}

/**
 * Rank the market list.
 *
 * "Which token gave the most return today", "biggest gainer", "what's up the
 * most", "show me today's winner" are four sentences and ONE capability:
 * sort the markets by 24h change, descending, take the top. That collapse is
 * the whole reason this union exists — thirty or forty capabilities absorb
 * thousands of phrasings, and the work is enumerating the capabilities, not
 * the sentences.
 *
 * Every metric here is a number already on screen in the left panel, which is
 * the test for whether something belongs in this union at all: the prompt bar
 * can do exactly what the UI can do.
 *
 * There is no `window`. cipher has ONE window — 24 hours — because that is
 * what the market list carries. "Most return today" and "most return this
 * hour" are different questions and only one of them is answerable, so the
 * answer says which one it answered rather than quietly rolling a day into a
 * calendar date.
 */
export interface ScreenIntent {
  kind: "screen";
  metric:
    /** 24h price change. */
    | "return"
    /** 24h traded volume in dollars. */
    | "volume"
    | "marketCap"
    | "price";
  /** Best first, or worst first. "Biggest loser" is `bottom` on `return`. */
  direction: "top" | "bottom";
  /** How many rows. Capped by the caller; a sentence cannot ask for a thousand. */
  limit: number;
}

/**
 * Look at, or cancel, what the trigger engine is watching.
 *
 * New with the engine, and not optional now that one exists: the moment a
 * sentence can arm a rule that sells without being asked twice, a sentence
 * has to be able to take it back. "Cancel my stop" must work as well as the
 * button does, because the person who most needs it is mid-panic.
 */
export interface RulesIntent {
  kind: "rules";
  action: "list" | "cancelAll";
}

/**
 * Operate the interface itself.
 *
 * Small, and worth having: these are the controls people never find. Nobody
 * discovers Alt+R, and "make the chart bigger" is a sentence everyone can say.
 */
export interface UiIntent {
  kind: "ui";
  action:
    | "collapsePanel"
    | "expandPanel"
    | "splitBottom"
    | "splitRight"
    | "resetChart";
}

/**
 * The boundary, made explicit.
 *
 * Three reasons, because the UI should respond differently to each and
 * collapsing them into one "sorry" is how a product feels stupid:
 *
 *   outOfScope   — cipher does not do this and never will. "What is the
 *                  weather", "find me new tokens on Twitter". Say so plainly;
 *                  do not apologise for a decision.
 *   notUnderstood — shaped like something cipher does, but unparseable. Worth
 *                  offering an example, because the user is close.
 *   notBuilt     — understood exactly, and the capability does not exist yet.
 *                  "Sell a third at 2x" is THIS one today: the grammar parses
 *                  it perfectly and nothing watches the price. Never let this
 *                  masquerade as notUnderstood — telling someone you did not
 *                  understand a sentence you understood completely is the one
 *                  refusal that destroys trust in the parser.
 */
export interface RefusalIntent {
  kind: "refusal";
  reason: "outOfScope" | "notUnderstood" | "notBuilt";
  /** Shown to the user verbatim. Say what happened and what to do instead. */
  message: string;
}

/**
 * Two readings, and no way to choose between them.
 *
 * "Buy 500 solana" is $500 of SOL or 500 SOL, and the sentence carries no
 * unit marker to say which. Knowing you do not know is DETERMINISTIC — the
 * grammar produces two parses and counts them — so this is not a case that
 * needs a model, it is a case that needs a question.
 *
 * EACH OPTION CARRIES THE SENTENCE REWRITTEN UNAMBIGUOUSLY, and picking one
 * re-runs the whole compiler on that sentence. Not "patch the half-parsed
 * spec with the answer": a patched spec has a code path nothing else uses,
 * and money paths must not have those. Re-running means the clarified
 * sentence goes through the same grammar, the same validate and the same
 * readback as anything typed by hand.
 */
export interface ClarifyIntent {
  kind: "clarify";
  /** The ambiguity, in one line. Shown above the options. */
  question: string;
  options: {
    /** What the button says. "$500 worth" */
    label: string;
    /** The full sentence, rewritten so it can only parse one way. */
    sentence: string;
  }[];
  /**
   * A MISSING VALUE rather than a choice between two readings.
   *
   * "Buy SOL at $95" is not ambiguous — it is incomplete. There is exactly one
   * reading and it has a hole in it, and the set of answers is every number,
   * so there are no buttons to offer. The user types it.
   *
   * The same rule as `options` still holds and it is the reason this is a
   * TEMPLATE rather than a field name: the answer is substituted into a whole
   * sentence and that sentence is compiled from scratch. Nothing anywhere
   * patches a half-built spec with a value — a patched spec is a code path
   * that no typed sentence ever takes, and money paths must not have those.
   *
   * Chains naturally when more than one thing is missing: the filled sentence
   * recompiles, and if it is still short of something the next clarify falls
   * out of the same machinery.
   */
  fill?: {
    /** The sentence with `{}` where the answer goes. "buy {} of sol at $95" */
    template: string;
    /**
     * What is being asked for. Drives the keyboard, the placeholder and the
     * check that "banana" is not a price before it reaches the compiler.
     */
    expects: "price" | "percent" | "size";
    /** A real example of a valid answer, shown in the input. "$500" */
    example: string;
  };
}

export type Intent =
  | OrderIntent
  | NavigateIntent
  | QueryIntent
  | ScreenIntent
  | RulesIntent
  | UiIntent
  | ClarifyIntent
  | RefusalIntent;

/**
 * A compiled sentence, with its provenance.
 *
 * `source` exists to be measured. If the grammar covers 85% of real traffic
 * the model is a rounding error on the bill; if it covers 30% the grammar
 * needs work, and you cannot know which without counting. Log it from the
 * first day the model path exists.
 *
 * NOTE ON DUPLICATION: OrderSpec carries its own `source` and `warnings`, and
 * they are not these. An armed rule outlives many compiles, so the spec's
 * copies are persisted WITH the rule; these describe this one compilation and
 * are thrown away with it.
 */
export interface Compiled {
  version: typeof INTENT_VERSION;
  intent: Intent;
  source: "grammar" | "model";
  /** Understood but not actionable. Surfaced in the readback, never silently. */
  warnings: string[];
}

/**
 * What the compiler is allowed to know.
 *
 * DELIBERATELY THIN, and the omissions are the point.
 *
 * The open market is here because "buy $500 of this" cannot be resolved
 * without it. Balance and price are NOT, and must never be added: give a model
 * the account and it starts making decisions — "you only have $200, so I will
 * buy $200" — and that is discretion. cipher's regulatory position is that it
 * transcribes an instruction and does not exercise judgement, and the moment
 * the compiler knows what you can afford, that stops being true.
 *
 * Whether an order is affordable is validate.ts's job, in deterministic code,
 * after compilation.
 */
export interface CompileContext {
  /** The market currently open, e.g. "SOLUSDT". Resolves "this" and "it". */
  symbol: string;
  /** The interval currently shown, so "zoom out" has a reference point. */
  interval: Interval;
  /** True when the user holds the open market. Resolves "sell half" vs a refusal. */
  hasPosition: boolean;
}
