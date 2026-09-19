import {
  INTENT_VERSION,
  type Compiled,
  type CompileContext,
  type Intent,
  type Interval,
  type NavigateIntent,
} from "@cipher/shared";
import { parseWithGrammar } from "./grammar.ts";
import { askForMissing, askForMissingTrigger } from "./missing.ts";
import { unconsumed } from "./unconsumed.ts";
import { normaliseSpeech } from "../voice/normalise.ts";
import { resolveMarket, namesToken } from "../market/markets.ts";

/**
 * The router. One sentence in, one Intent out, always.
 *
 * Nothing called grammar.ts and nothing used the Intent union — the compiler
 * was a parser with no front door. This is the front door.
 *
 * ORDER IS THE WHOLE DESIGN. Every matcher below is a regex over the same
 * string, and several of them can match the same sentence: "sell half at 2x"
 * contains "sell", and a naive "sell" matcher would eat an order. So the
 * specific runs before the general, orders run before anything that merely
 * mentions a market, and the last line is always a refusal rather than a
 * guess. A compiler that guesses is worse than one that declines.
 *
 * It never returns null. A sentence nobody can parse is a `refusal` with a
 * reason, because "I didn't understand" and "cipher doesn't do that" and "it
 * isn't built yet" need three different answers and collapsing them is how a
 * product feels stupid.
 */

/** Cheap normalisation shared by every matcher: lowercase, collapsed spaces. */
function flatten(raw: string): string {
  return normaliseSpeech(raw).toLowerCase().replace(/\s+/g, " ").trim();
}

function ok(intent: Intent, warnings: string[] = []): Compiled {
  return { version: INTENT_VERSION, intent, source: "grammar", warnings };
}

function refuse(
  reason: "outOfScope" | "notUnderstood" | "notBuilt",
  message: string,
): Compiled {
  return {
    version: INTENT_VERSION,
    intent: { kind: "refusal", reason, message },
    source: "grammar",
    warnings: [],
  };
}

/* ──────────────────────────── the ambiguity ────────────────────────────── */

/**
 * "Buy 500 solana" — $500 of SOL, or 500 SOL?
 *
 * Detected, not guessed. The test is structural: a buy with a bare number and
 * no unit marker. `$500` has a marker. `500 SOL worth of` has one. A naked
 * number has none, and both readings are ordinary things to say.
 *
 * Deliberately NOT resolved by plausibility — "500 SOL is $50,000 and you only
 * have $10,000, so they must have meant dollars" is the compiler exercising
 * judgement about the user's balance, which is exactly the line cipher does
 * not cross. CompileContext has no balance in it for this reason.
 */
function ambiguousSize(text: string, label?: string): Compiled | null {
  /*
   * "BUY FOR A HUNDRED SOL." Spoken, "for" and "four" are one sound, and the
   * sentence reads either way — $100 of SOL, or 100 (or 400) SOL. Found live:
   * the model read it as 100 SOL, $11,200 on a $10,000 account, and only the
   * cash check stopped it. A size after "for" with no unit is always asked.
   */
  const spoken = text.match(/\b(buy|sell)\s+for\s+([\d.,]+)\s+(?:of\s+)?([a-z][a-z0-9]{1,14})\b/);
  if (spoken) {
    const [, side, number, token] = spoken;
    const upper = resolveMarket(token)?.base ?? token.toUpperCase();
    return ok({
      kind: "clarify",
      question: `Do you mean $${number} worth of ${upper}, or ${number} ${upper}?`,
      options: [
        { label: `$${number} worth`, sentence: `${side} $${number} of ${token}` },
        { label: `${number} ${upper}`, sentence: `${side} ${number} tokens of ${token}` },
      ],
    });
  }

  const m = text.match(
    /\b(buy|sell)\s+(?:me\s+)?([\d.,]+)\s+(?:of\s+)?([a-z][a-z0-9]{1,14})\b/,
  );
  if (!m) return null;

  const [, side, number, token] = m;
  // A unit marker anywhere around the number settles it; only a naked number
  // is ambiguous.
  if (/[$%]/.test(text) || /\b(worth|dollars?|usd|tokens?|coins?)\b/.test(text)) return null;
  /*
   * KNOWN MEANS A MAJOR OR THE COIN ON SCREEN. Only the majors counted, so
   * with BONK open "buy 100 bonk" skipped the question and bought 100 BONK —
   * the same sentence that asks about SOL. A coin that is neither is a
   * different problem, and Sana says so in its own sentence.
   */
  const major = resolveMarket(token);
  if (!major && !namesToken(token, label)) return null;
  const upper = major?.base ?? (label ?? token).toUpperCase();
  return ok({
    kind: "clarify",
    question: `Do you mean $${number} worth of ${upper}, or ${number} ${upper}?`,
    options: [
      { label: `$${number} worth`, sentence: `${side} $${number} of ${token}` },
      { label: `${number} ${upper}`, sentence: `${side} ${number} tokens of ${token}` },
    ],
  });
}

/* ───────────────────────────────── screen ──────────────────────────────── */

const SCREEN_METRIC: [RegExp, "return" | "volume" | "marketCap" | "price"][] = [
  [/\b(return|gain|up|pump|perform|mover|winner|loser|down|change)\w*\b/, "return"],
  [/\b(volume|traded|turnover)\w*\b/, "volume"],
  [/\b(market ?cap|mcap|biggest|largest)\b/, "marketCap"],
  [/\b(price|expensive|cheap)\w*\b/, "price"],
];

/** "worst", "biggest loser", "most down" — the bottom of the same list. */
const BOTTOM = /\b(worst|loser|losing|down|fell|dropped|bottom|cheapest|lowest|smallest)\b/;

function screen(text: string): Compiled | null {
  /*
   * A screen has to be ASKED FOR. "which", "what", "find", "show", "top" —
   * without one of these, "SOL is up today" is a statement and matching it
   * would answer a question nobody asked.
   */
  if (!/\b(which|what|find|show|list|top|best|worst|biggest|most|least)\b/.test(text)) {
    return null;
  }
  /*
   * About the market list, not about the user's own account.
   *
   * POSSESSIVES ONLY. The first version guarded on "me" as well, which killed
   * "show me the top 5 gainers" and "find me the best performer" — the two
   * most natural ways to ask for a screen. "me" is an indirect object here,
   * not ownership. "my" and "mine" are the words that mean the account.
   */
  if (/\b(my|mine)\b/.test(text) || /\bdo i\b/.test(text)) return null;

  const metric = SCREEN_METRIC.find(([re]) => re.test(text))?.[1];
  if (!metric) return null;

  const limitMatch = text.match(/\btop\s+(\d{1,2})\b/) ?? text.match(/\b(\d{1,2})\s+(?:best|worst)\b/);
  const limit = Math.min(Number(limitMatch?.[1] ?? 1) || 1, 14);

  const warnings: string[] = [];
  /*
   * "Today" is not 24 hours, and cipher only has 24 hours.
   *
   * Answering the question we can answer and SAYING SO beats both silently
   * pretending a rolling window is a calendar day, and refusing a question
   * that is 95% answerable.
   */
  if (/\b(today|this hour|last hour|this week|right now)\b/.test(text)) {
    warnings.push("cipher measures one window — the last 24 hours. That is what this answers.");
  }

  return ok(
    { kind: "screen", metric, direction: BOTTOM.test(text) ? "bottom" : "top", limit },
    warnings,
  );
}

/* ───────────────────────────────── rules ───────────────────────────────── */

function rules(text: string): Compiled | null {
  if (/\bcancel\s+(all|every|my)\b.*\b(rule|order|stop|exit|alert)s?\b/.test(text)) {
    return ok({ kind: "rules", action: "cancelAll" });
  }
  if (
    /\b(what|which|show|list)\b.*\b(rule|order|stop|exit|alert|armed|watching)s?\b/.test(text) ||
    /\bwhat('?s| is)\s+armed\b/.test(text)
  ) {
    return ok({ kind: "rules", action: "list" });
  }
  return null;
}

/* ───────────────────────────────── query ───────────────────────────────── */

const QUERY: [RegExp, "position" | "cash" | "equity" | "pnl" | "fills" | "market" | "fees"][] = [
  [/\b(position|holding|bag|how much .*(do i (hold|have|own)))\b/, "position"],
  [/\b(cash|usdc|buying power|dry powder|how much .*(can i spend))\b/, "cash"],
  [/\b(equity|net worth|account value|total)\b/, "equity"],
  [/\b(p ?& ?l|pnl|profit|loss|up or down|made|lost)\b/, "pnl"],
  [/\b(fills?|trades?|history)\b/, "fills"],
  [/\b(fees?|commission|charged)\b/, "fees"],
  [/\b(price|market ?cap|mcap|volume|liquidity|24h?)\b/, "market"],
];

function query(text: string): Compiled | null {
  if (!/\b(what|show|how|tell|am i|do i|give me|list)\b/.test(text)) return null;
  const subject = QUERY.find(([re]) => re.test(text))?.[1];
  if (!subject) return null;
  return ok({ kind: "query", subject });
}

/* ─────────────────────────────── navigate ──────────────────────────────── */

const INTERVALS: Record<string, Interval> = {
  "1m": "1m", "1 minute": "1m", minute: "1m",
  "5m": "5m", "5 minute": "5m",
  "15m": "15m", "15 minute": "15m",
  "1h": "1h", hourly: "1h", hour: "1h",
  "4h": "4h", "4 hour": "4h",
  "1d": "1d", daily: "1d", day: "1d",
};

function navigate(text: string, ctx: CompileContext): Compiled | null {
  const intent: NavigateIntent = { kind: "navigate" };

  const shown = text.match(
    /\b(?:show|open|go to|switch to|pull up|chart|look at)\s+(?:me\s+)?(?:the\s+)?([a-z][a-z0-9]{1,14})\b/,
  );
  const def = shown ? resolveMarket(shown[1]) : null;
  if (def) intent.symbol = def.symbol;

  for (const [word, interval] of Object.entries(INTERVALS)) {
    if (new RegExp(`\\b${word.replace(/\s/g, "\\s")}\\b`).test(text)) {
      intent.interval = interval;
      break;
    }
  }

  if (/\balerts?\b/.test(text)) intent.panel = "alerts";
  else if (/\b(leader ?board|leaders)\b/.test(text)) intent.panel = "leaders";
  else if (/\bfeed\b/.test(text)) intent.panel = "feed";
  else if (/\b(tokens?|markets?|coins?)\b/.test(text) && /\b(show|open|go to)\b/.test(text)) {
    intent.panel = "tokens";
  }

  if (!intent.symbol && !intent.interval && !intent.panel) return null;
  // "show me SOL" while SOL is open is not nothing — it is a no-op the UI can
  // answer honestly, which is better than a refusal.
  if (intent.symbol === ctx.symbol && !intent.interval && !intent.panel) {
    return ok({ kind: "navigate", symbol: intent.symbol });
  }
  return ok(intent);
}

/* ────────────────────────────────── ui ─────────────────────────────────── */

const UI: [RegExp, "collapsePanel" | "expandPanel" | "splitBottom" | "splitRight" | "resetChart"][] = [
  [/\b(collapse|hide|close)\b.*\b(panel|sidebar|left)\b/, "collapsePanel"],
  [/\b(expand|show|open)\b.*\b(panel|sidebar|left)\b/, "expandPanel"],
  [/\bsplit\s+bottom\b/, "splitBottom"],
  [/\bsplit\s+right\b/, "splitRight"],
  [/\b(reset|fit|default)\b.*\bchart\b/, "resetChart"],
  [/\bzoom\s+(out|reset)\b/, "resetChart"],
];

function ui(text: string): Compiled | null {
  const action = UI.find(([re]) => re.test(text))?.[1];
  return action ? ok({ kind: "ui", action }) : null;
}

/* ─────────────────────────────── out of scope ──────────────────────────── */

/**
 * Things cipher will never do, named so the refusal can be specific.
 *
 * Saying "I can't search the web" is a different message from "I didn't
 * understand you", and the user learns the boundary from the first and
 * learns nothing from the second.
 */
const OUT_OF_SCOPE: [RegExp, string][] = [
  [/\b(weather|news|headline|tweet|twitter|reddit|telegram|google|search the web)\b/,
   "I only do what this terminal does. I can't search the web or read social feeds."],
  /*
   * An opinion is an opinion however it is phrased. "Is SOL going to pump"
   * and "what do you think of bonk" were refused for the WRONG reason —
   * "I didn't get that", which invites a rephrase of a question cipher will
   * never answer however it is put.
   */
  [/\b(should i|is it a good|will it|predict|forecast|moon|going to go|worth buying)\b/,
   "I don't give opinions on what to trade. Tell me what you want done and I'll do it."],
  [/\b(going to|gonna)\s+(pump|dump|moon|rug|run|crash|go\s+up|go\s+down)\b|\bwhat do you think\b|\bthoughts on\b|\byour take\b|\bis\s+\w+\s+a\s+(good|bad)\s+(buy|call|bet)\b/,
   "I don't call the market. Tell me what you want done and I'll do it."],
  /*
   * Moving money OUT is a different refusal from not understanding, and the
   * wallet/address/bank qualifier meant the plainest phrasing — "send $500 to
   * my friend" — missed it entirely.
   */
  [/\b(withdraw|deposit|send|transfer|pay|wire)\b.*\b(wallet|address|bank|friend|someone|him|her|them|to\s+\w+)\b/,
   "Funding and transfers aren't built yet. The account here is paper money."],
];

/**
 * Things cipher WILL do and cannot do yet.
 *
 * A different refusal from out-of-scope, and the difference is the whole
 * reason there are three reasons. "Short SOL with 5x leverage" came back as
 * "I didn't get that", which tells a user they typed it wrong — so they try
 * four more phrasings of a sentence that was perfectly clear. The honest
 * answer is that perps are phase 3.
 *
 * It also has to run BEFORE the order grammar, because "long sol 3x" parses
 * as a spot buy of a token called "long" and "close my short" sold a hundred
 * percent of a position in a coin named "short". Leverage silently becoming
 * spot is the worst outcome available here: same direction, wrong instrument,
 * and no liquidation price anywhere on the card.
 */
const NOT_BUILT: [RegExp, string][] = [
  [
    /\b(short|shorting|long)\b.*\b(\d+\s*x|leverage|lever|margin|perp|perpetual)\b|\b(\d+\s*x|leverage|margin|perp|perpetual)\b.*\b(short|shorting|long)\b|\b(perp|perpetual|funding rate|liquidation price|margin mode|isolated|cross margin)\b/,
    "Perps aren't built yet — no shorting, no leverage. Spot only for now, so I can buy or sell what you actually hold.",
  ],
  [
    /\bclose\s+my\s+(short|long|position)\s*$/,
    "Perps aren't built yet, so there's no short or long to close. Name the token and I'll sell the spot position — \"sell all my SOL\".",
  ],
];

function outOfScope(text: string): Compiled | null {
  const hit = OUT_OF_SCOPE.find(([re]) => re.test(text));
  if (hit) return refuse("outOfScope", hit[1]);
  const later = NOT_BUILT.find(([re]) => re.test(text));
  return later ? refuse("notBuilt", later[1]) : null;
}

/* ──────────────────────────────── the router ───────────────────────────── */

export function compile(raw: string, ctx: CompileContext): Compiled {
  const text = flatten(raw);
  if (!text) return refuse("notUnderstood", "Say what you want and I'll do it.");

  /*
   * Out of scope first.
   *
   * "Should I buy SOL?" contains "buy SOL", and letting the order grammar see
   * it would turn a question into a trade. Refusing an opinion is the safest
   * possible thing to get wrong; filling one is the worst.
   */
  const declined = outOfScope(text);
  if (declined) return declined;

  const unclear = ambiguousSize(text, ctx.label);
  if (unclear) return unclear;

  /*
   * Orders next, because they are the most specific thing here and every
   * other matcher is looser. "sell half at 2x" mentions a size and a market
   * and would be caught by three of the matchers below.
   */
  const spec = parseWithGrammar(text);
  /*
   * A DOLLAR AMOUNT THE PARSE DID NOT USE means the grammar read HALF the
   * sentence. "put ten bucks in and cut me if it drops ten percent" matched
   * the stop, dropped the buy, and came back as exits on a position nobody
   * holds. Handing the whole sentence to the model is right; answering the
   * half the grammar understood is not.
   */
  /* "Used" means it became an amount OR a price. The first version counted
     only amounts, so "sell half at $250" — whose $250 is the target — was
     refused as half-read. */
  const used = new Set<number>(
    (spec?.exits ?? []).flatMap((x) => [
      ...(x.amount.kind === "usd" ? [x.amount.value] : []),
      ...(x.trigger.kind === "priceAbsolute" ? [x.trigger.value] : []),
    ]),
  );
  const lostMoney =
    spec !== null &&
    !spec.entry &&
    [...text.matchAll(/\$\s*([\d.,]+)/g)].some((m) => !used.has(Number(m[1].replace(/,/g, ""))));
  if (spec && !lostMoney) {
    /* A parse can succeed and still be wrong: a stated condition with no price
       becomes `trigger: null`, which fills NOW. Ask rather than trade. */
    const noPrice = askForMissingTrigger(text, spec);
    if (noPrice) return noPrice;
    /*
     * Anything the sentence asked for that the spec does not carry, said out
     * loud on the readback. A dropped modifier is a warning rather than a
     * refusal: the buy is still wanted, the tip just did not take.
     */
    return ok({ kind: "order", spec }, [...spec.warnings, ...unconsumed(text, spec)]);
  }

  for (const matcher of [rules, screen, query, ui]) {
    const hit = matcher(text);
    if (hit) return hit;
  }

  const nav = navigate(text, ctx);
  if (nav) return nav;

  /*
   * LAST, deliberately. `askForMissing` recognises order-shaped sentences by
   * their verbs, and "close" opens a position in one vocabulary and shuts a
   * panel in another — so "close the panel" would ask how much panel to sell
   * if this ran any earlier. Everything with a better claim on the sentence
   * has already had it.
   */
  const incomplete = askForMissing(text);
  if (incomplete) return incomplete;

  return refuse(
    "notUnderstood",
    'I didn\'t get that. Try "buy $250 of SOL", "stop at -20%", "what\'s my P&L", or "which token is up the most".',
  );
}
