import type { CompileContext, Conversion } from "@cipher/shared";
import { OPENS, SIDES } from "./verbs.ts";
import { resolveMarket, namesToken } from "../market/markets.ts";

/**
 * Loose phrasing in, the grammar's own phrasing out.
 *
 * WHY A REWRITE AND NOT MORE GRAMMAR. The user's list of how traders actually
 * talk, 24 Sep 2026 — "ape $500 into SOL at market price immediately", "take
 * half off the table at +15%", "sell 30% if it goes down 5% as a stop", "look
 * for a 10% drop on SOL, then ape $100 into it". Four in thirty executed.
 *
 * None of them asks for anything the grammar cannot already build. "+15%" is
 * a target at 1.15x, which "target at 15%" produces. "Sell 30% if it goes down
 * 5%" is a stop on 30%, which "stop 30% at 5%" produces. The gap is WORDING,
 * so the fix is a translation into sentences the grammar has always read —
 * not a second copy of every exit rule with the words shuffled.
 *
 * A REWRITE, NEVER A PATCHED SPEC. The rule in shared/intent.ts: nothing
 * patches a half-built order with a value, because a patched spec is a code
 * path no typed sentence ever takes. Everything here comes out as a sentence,
 * and that sentence goes through the same grammar, validator and readback as
 * one typed by hand. If the user answers a question about it, the sentence
 * they are answering is this one.
 *
 * WHAT IT MAY NOT DO is invent. Every rewrite below renames something the
 * user said. None of them supplies a size, a level or a token that was not in
 * the sentence — their own example turned "buy me Solana when it drops 10%"
 * into a $100 order, and cipher asks instead.
 */

export interface Rephrased {
  text: string;
  /** Numbers the user said that became something else, for the readback. */
  conversions: Conversion[];
}

/** A size said in front of an exit. */
const SIZE =
  "(?:a\\s+third|a\\s+half|half|a\\s+quarter|quarter|third|all|everything|the\\s+rest|rest|\\d+(?:\\.\\d+)?\\s*%)";
const NUM = "(\\d+(?:\\.\\d+)?)";
/** Every word that ends the entry and starts an exit, once rewritten. */
const EXIT_WORD = /\b(?:sell|dump|cut|stop|target|take\s+profit|tp|trail(?:ing)?|scale\s+out)\b/;

/**
 * A price in plain digits. `String(n)` writes 0.00000012 as "1.2e-7", which
 * the grammar reads as 1.2 and a stray "e" — a memecoin price is exactly the
 * number that hits this.
 */
function plain(n: number): string {
  const digits = n >= 1 ? 4 : Math.min(12, 3 - Math.floor(Math.log10(n)) + 3);
  return n.toFixed(digits).replace(/\.?0+$/, "");
}

/** The first word that names a coin cipher can trade here. */
function namedToken(text: string, ctx: CompileContext): string | null {
  for (const w of text.split(/[^a-z0-9$]+/)) {
    if (w.length < 2) continue;
    if (resolveMarket(w) || namesToken(w, ctx.label, ctx.symbol)) return w.replace(/^\$/, "");
  }
  return null;
}

export function rephrase(input: string, ctx: CompileContext): Rephrased {
  let t = ` ${input} `;
  const conversions: Conversion[] = [];

  /* ── money said as words ────────────────────────────────────────────────
     "50 bucks", "200 dollars", "1k cash" are dollars. CASH is also a coin, so
     "cash" only counts as money when that coin is not the one on screen. */
  const money = namesToken("cash", ctx.label, ctx.symbol)
    ? "bucks|dollars?|usd|usdc"
    : "bucks|dollars?|usd|usdc|cash";
  t = t.replace(new RegExp(`(\\$\\s*\\d[\\d.,]*\\s*[km]?)\\s+(?:${money})\\b`, "g"), "$1");
  t = t.replace(new RegExp(`(?<![$\\d.,])(\\d[\\d,]*(?:\\.\\d+)?\\s*[km]?)\\s*(?:${money})\\b`, "g"), "$$$1");

  /* ── words that carry nothing ───────────────────────────────────────────
     Urgency is the default — every order without a price fills now — so
     "immediately" and "at market" are instructions cipher already follows.
     "market" only goes when it is not "market cap". */
  const FILLER = [
    /^\s*(?:yo|okay|ok|so|hey|alright)\b[,\s]*/,
    /\b(?:right\s+(?:now|away|this\s+second)|immediately|instantly|asap|don'?t\s+wait|let'?s\s+ride|get\s+me\s+out|no\s+questions\s+asked)\b/g,
    /\b(?:at|on)\s+(?:the\s+)?(?:current\s+)?market(?:\s+price)?\b(?!\s*cap)/g,
    /\bat\s+(?:the\s+)?current\s+price\b/g,
    /(?<!\bfrom\s)\bnow\b/g,
    /* NOT "limit". "Put a limit buy on solana for $500" has no price, and the
       word is what makes cipher ask for one — strip it and it fills at market. */
    /\b(?:market|instant|panic)\s+(?=(?:buy|sell)\b)/g,
    /\binstant\s+fill\b|\bfull\s+send(?:\s+on)?\b|\bchop\s+up\b|\bcatch\s+the\s+knife(?:\s+on)?\b/g,
    /\bsplit\s+my\s+exits?\b|\bdca\s+style(?:\s+entry)?\b/g,
    /\ba\s+bag\s+of\b|\b(?:my\s+)?(?:entire|whole)\s+(\w+)\s+bag\b/g,
    /\btight(?:ly)?\b/g,
  ];
  /* A pattern with no group hands the callback its offset, not a string. */
  for (const re of FILLER) t = t.replace(re, (_m, bag: unknown) => (typeof bag === "string" ? ` all my ${bag} ` : " "));

  /* ── verbs for opening a position ───────────────────────────────────────
     Each of these is "buy" said another way. `long` only reaches here without
     leverage — compile.ts refuses the leveraged form before this runs. */
  t = t
    .replace(/\bpick\s+up\b/g, "buy")
    .replace(/\bget\s+(?:me\s+)?into\b/g, "buy")
    .replace(/\bgo\s+long(?:\s+on)?\b/g, "buy")
    .replace(/(^|[,.;:]|\bthen)\s*long\b/g, "$1 buy")
    .replace(/\bopen\s+a\s+(\$\s*[\d.,]+\s*[km]?)\s+position\s+(?:on|in)\b/g, "buy $1 of")
    .replace(/\b(?:open|enter)\s+a\s+position\s+(?:with|of|for|on)\b/g, "buy")
    .replace(/\benter\b/g, "buy")
    .replace(new RegExp(`\\btake\\s+(${SIZE})\\s+off\\s+the\\s+table\\b`, "g"), "sell $1")
    .replace(/\bnuke\b/g, "sell");
  /* "Limit order SOL: buy $500 when…" already has its verb. "Set a limit
     order for SOL down 15%" does not, and with no position to sell it can
     only be a buy — the same reasoning as impliedBuy in compile.ts. */
  const limitOrder = /\b(?:set\s+|place\s+)?(?:a\s+)?limit\s+order\b(?:\s+(?:for|on))?/;
  if (limitOrder.test(t)) {
    const withoutIt = t.replace(limitOrder, " ");
    const verb = new RegExp(`\\b(?:${SIDES})\\b`).test(withoutIt);
    /* "limit" survives either way, for the same reason as above. */
    t = verb ? t.replace(limitOrder, " limit ") : ctx.hasPosition ? t : t.replace(limitOrder, " limit buy ");
  }

  /* ── gains ──────────────────────────────────────────────────────────────
     "+15%", "a 20% gain", "8% profit", "12% upside", "30% up", "10% higher",
     "10% more than the current price" — one idea, said seven ways. Marked
     first as "N% gain" so the rules after this read one spelling. */
  t = t
    .replace(new RegExp(`\\+\\s*${NUM}\\s*%`, "g"), "$1% gain")
    .replace(
      new RegExp(
        `${NUM}\\s*%\\s+(?:profit|gain|upside|higher|up|rise|more(?:\\s+than\\s+(?:the\\s+)?(?:current\\s+price|entry|my\\s+entry|what\\s+i\\s+paid))?|above\\s+(?:my\\s+|the\\s+)?entry)\\b`,
        "g",
      ),
      "$1% gain",
    )
    .replace(/% gain\s+gain\b/g, "% gain")
    .replace(new RegExp(`\\ba\\s+${NUM}% gain\\b`, "g"), "$1% gain");

  /* "Take profit 1 at +20%, take profit 2 at +50%" — a label, not a size. The
     digits are recorded so the check that every number landed somewhere does
     not refuse the order over a "1" nobody meant as a quantity. */
  const labels: number[] = [];
  t = t.replace(/\b(take\s+profit|target|tp)\s+#?(\d)\s*(?=at\b|@|:|of\b)/g, (_m, word: string, n: string) => {
    labels.push(Number(n));
    return `${word} `;
  });
  if (labels.length) conversions.push({ said: labels, note: "" });

  t = t
    .replace(new RegExp(`${NUM}% gain\\s+(?:profit\\s+)?target\\b`, "g"), "target at $1%")
    .replace(
      new RegExp(`\\b(?:target|take\\s+profit|tp)(?:\\s+price)?\\s+(?:(?:for|of|at|to|is)\\s+)?(?:a\\s+)?${NUM}% gain`, "g"),
      "target at $1%",
    )
    /* A rung: a size, then a gain. The verb is optional because nobody says
       it twice — "sell 50% at +10%, another 25% at +20%". */
    .replace(
      new RegExp(
        `(?:\\b(?:sell|take|dump|offload|scale\\s+out)\\s+)?(?:\\b(?:the\\s+other|another)\\s+)?\\b(${SIZE})\\s+` +
          `(?:of\\s+(?:it|them|that)\\s+)?(?:off\\s+the\\s+table\\s+)?` +
          `(?:at|on|when\\s+it\\s+(?:hits|reaches|gets\\s+to|is(?:\\s+up)?)|once\\s+it\\s+(?:hits|reaches))\\s+${NUM}% gain`,
        "g",
      ),
      "take profit $1 at $2%",
    )
    /* One level with no size is the whole position: "otherwise scale out at
       +15%". Two or more with none is left alone and asked about below. */
    .replace(new RegExp(`\\bscale\\s+out\\s+at\\s+${NUM}% gain\\b(?!\\s*(?:,|and\\b))`, "g"), "take profit at $1%");

  /* ── losses, as sized stops ────────────────────────────────────────────
     "sell 30% if it goes down 5%", "dump the remaining 60% if it breaks below
     entry by 8%", "cut the rest if it drops 5%". Only after a buy in the same
     sentence: then "down 5%" can only be measured from that buy's fill. For a
     position already held it could mean from here or from entry, and that is
     not a coin this rewrite gets to flip. */
  const opens = new RegExp(`\\b(?:${OPENS})\\b`);
  if (opens.test(t)) {
    t = t.replace(
      new RegExp(
        `\\b(?:sell|dump|cut|close|exit|offload|unload)\\s+(?:the\\s+remaining\\s+|remaining\\s+)?(${SIZE})?\\s*` +
          `(?:of\\s+(?:it|them|that)\\s+)?(?:if|when|once)\\s+(?:it|price|the\\s+price)\\s+` +
          `(?:goes(?:\\s+down)?|drops|falls|dips|dumps|slides|is(?:\\s+down)?|breaks\\s+below(?:\\s+(?:my\\s+|the\\s+)?entry)?)\\s+` +
          /* `-5%`: normaliseSpeech has already written "down 5%" that way. */
          `(?:by\\s+)?-?\\s*${NUM}\\s*%(?:\\s+(?:below|from)\\s+(?:my\\s+|the\\s+)?entry)?(?:\\s+as\\s+a\\s+stop(?:\\s+loss)?)?`,
        "g",
      ),
      (_m, size: string | undefined, n: string) => (size ? `stop ${size} at ${n}%` : `stop at ${n}%`),
    );
  }

  /* ── the entry's condition ─────────────────────────────────────────────
     "when it drops 10%", "if it falls 8% lower", "down 15% from here", "a 10%
     drop" — all a resting buy below the market, measured from the price now.
     Converted to that price and SAID, because the order will rest at a
     number the user never typed. Only before the first exit word: after it,
     a drop is a stop's business, not the entry's. */
  let at: number | null = null;
  const exitAt = t.search(EXIT_WORD);
  const before = (i: number) => exitAt < 0 || i < exitAt;
  const buying = opens.test(t);

  const relative = [
    new RegExp(
      `(?:\\b(?:when|if|once|after)\\s+(?:it|price|the\\s+price)\\s+)?\\b(?:drops?|falls?|dips?|dumps?|pulls?\\s+back|retraces?|slides?(?:\\s+down)?|goes(?:\\s+down)?|comes\\s+down|is(?:\\s+down)?|down)\\s+(?:by\\s+)?(?:another\\s+)?-?\\s*${NUM}\\s*%(?:\\s+(?:lower|from\\s+here|down))?`,
    ),
    /* "SOL -15% from here" — "down 15%" after normaliseSpeech. A bare minus
       only counts with "from here" or "lower" behind it; alone it is a stop. */
    new RegExp(`(?<=\\s)-\\s*${NUM}\\s*%\\s+(?:from\\s+(?:here|now)|lower)\\b`),
    new RegExp(`\\b(?:a\\s+)?${NUM}\\s*%\\s+(?:drop|dip|pullback|pull\\s*back|retrace(?:ment)?|lower)\\b`),
  ];
  if (buying && ctx.price && ctx.price > 0) {
    for (const re of relative) {
      const m = t.match(re);
      if (!m || m.index == null || !before(m.index)) continue;
      const pct = Number(m[1]);
      if (!(pct > 0 && pct < 100)) continue;
      at = Number(plain(ctx.price * (1 - pct / 100)));
      conversions.push({
        said: [pct],
        note: `Read "down ${pct}%" as $${plain(at)} — ${pct}% below $${plain(ctx.price)}, the price now.`,
      });
      t = t.slice(0, m.index) + " " + t.slice(m.index + m[0].length);
      break;
    }
  }

  /* A condition said BEFORE the verb — "if Solana dips to 135, grab $1000
     worth". The grammar reads a resting price from the entry's own clause,
     which starts at the verb, so a price in front of it was never seen. */
  if (at === null && buying) {
    const verbAt = t.search(opens);
    const m = t.match(
      /\b(?:if|when|once)\s+(it|price|the\s+price|[a-z][a-z0-9]{1,14})\s+(?:dips?|drops?|falls?|comes\s+down|pulls?\s+back|gets|goes(?:\s+down)?|hits|reaches|touches)\s+(?:down\s+)?(?:to|below|under)\s*\$?\s*(\d[\d,]*(?:\.\d+)?)\b(?!\s*[%x])/,
    );
    if (m && m.index != null && m.index < verbAt) {
      at = Number(m[2].replace(/,/g, ""));
      t = t.slice(0, m.index) + ` ${m[1]} ` + t.slice(m.index + m[0].length);
    }
  }

  t = placeEntry(t, ctx, at);
  return {
    text: t
      .replace(/\s+([,.;:])/g, "$1")
      .replace(/\s+/g, " ")
      .trim()
      /* A removed "okay," leaves its comma behind, and a question template
         that opens ", buy {} of…" reads like a bug. */
      .replace(/^[,.;:\s]+/, ""),
    conversions,
  };
}

/**
 * Put the entry in the grammar's order — verb, size, token, price — wherever
 * the user put its pieces.
 *
 * "Panic buy SOL for $300", "grab $1000 worth", "pick up $500 of it", "size
 * is $400": the size and the coin are both there and not next to the verb.
 * Only ONE dollar figure before the first exit counts, and the coin has to be
 * one cipher can name — two figures, or a word it cannot resolve, and the
 * sentence goes on unchanged to be asked about.
 */
function placeEntry(t: string, ctx: CompileContext, at: number | null): string {
  const price = at === null ? "" : ` at $${plain(at)}`;
  const opens = new RegExp(`\\b(?:${OPENS})\\b(?:\\s+me\\b)?`);

  const canonical = t.match(
    new RegExp(
      `\\b(?:${OPENS})\\s+(?:me\\s+)?\\$\\s*[\\d.,]+\\s*[km]?\\s+(?:of\\s+|worth\\s+of\\s+|into\\s+|in\\s+|on\\s+)?` +
        `(?!(?:and|then|once|when|if|at|with|for|to|the|an|my|it|is|in|into|of|on|worth)\\b)[a-z0-9]{2,15}\\b`,
    ),
  );
  if (canonical?.index != null) {
    const end = canonical.index + canonical[0].length;
    return price ? t.slice(0, end) + price + t.slice(end) : t;
  }

  const exitAt = t.search(EXIT_WORD);
  const head = exitAt < 0 ? t : t.slice(0, exitAt);
  /* A dollar figure after "at", "below", "to" is a PRICE. "Buy solana at $95"
     became a $95 market buy — the one number that said "not yet", spent. */
  const amounts = [
    ...head.matchAll(/(?<!\b(?:at|@|below|under|above|over|to|hits?|reaches|touches)\s*)\$\s*[\d.,]*\d\s*[km]?\b/g),
  ];
  const verb = t.match(opens);
  const token = namedToken(t, ctx);

  if (amounts.length === 1 && verb?.index != null && token) {
    const amount = amounts[0][0].replace(/\s+/g, "");
    const around = new RegExp(
      `(?:\\b(?:for|with|use|using|size\\s+is|worth)\\s+)?${amounts[0][0].replace(/[$.*+?^{}()|[\]\\]/g, "\\$&")}` +
        `(?:\\s+worth)?(?:\\s+(?:of|into|in|on)(?:\\s+(?:it|them))?)?`,
    );
    const stripped = t.replace(around, " ");
    const v = stripped.match(opens);
    if (v?.index == null) return t;
    return stripped.slice(0, v.index) + `buy ${amount} of ${token}${price} ` + stripped.slice(v.index + v[0].length);
  }

  /* No size said: put the price beside the coin, so the question "how much?"
     carries it into the answer. */
  if (price) {
    const sizeless = t.match(new RegExp(`\\b(?:${OPENS})\\s+(?:me\\s+)?(?:some\\s+)?[a-z][a-z0-9]{1,14}\\b`));
    if (sizeless?.index != null) {
      const end = sizeless.index + sizeless[0].length;
      return t.slice(0, end) + price + t.slice(end);
    }
  }
  return t;
}

/**
 * What the sentence still leaves open after the rewrite, as a question.
 *
 * Each of these was said, and none of them can be armed without a number the
 * user did not give: a trailing stop with no distance, levels with no sizes,
 * a stop at "break-even", a level that repeats. Inventing any of them is
 * inventing where somebody's position gets sold.
 */
export function leftOpen(text: string): { question: string; template?: string; expects?: "percent" } | null {
  if (/\btrail(?:ing)?\s+stop\b/.test(text) && !/\btrail(?:ing)?(?:\s+stop)?(?:\s+loss)?\s*(?:at|of|by)?\s*\d/.test(text)) {
    return {
      question: "How far behind the high should the trailing stop follow?",
      template: text.replace(/\btrail(?:ing)?\s+stop(?:\s+loss)?\b/, "trailing stop at {}"),
      expects: "percent",
    };
  }
  if (/\bbreak[\s-]*even\s+stop\b|\bstop\s+(?:at\s+)?break[\s-]*even\b/.test(text)) {
    return {
      question: "Where should that stop sit? cipher doesn't arm a break-even stop yet — give it a level.",
      template: text.replace(/\bbreak[\s-]*even\s+stop\b|\bstop\s+(?:at\s+)?break[\s-]*even\b/, "stop at {}"),
      expects: "percent",
    };
  }
  if (/\bevery\s+\d+(?:\.\d+)?\s*%/.test(text)) {
    return {
      question: 'cipher arms fixed levels, not a repeating one. Say each level — "sell 25% at +10%, 25% at +20% and the rest at +30%".',
    };
  }
  if (/\d% gain\b/.test(text)) {
    return {
      question: 'How much sells at each level? Say it like "sell half at +10% and the rest at +25%".',
    };
  }
  return null;
}
