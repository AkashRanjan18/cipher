/**
 * Spoken English → text the compiler can parse.
 *
 * Speech recognition returns words, and the grammar in lib/compiler wants
 * symbols. Nobody says "dollar sign five hundred" — they say "five hundred
 * dollars" — and no recogniser has ever heard "SOL" and written "sol" every
 * time. Without this layer the canonical sentence arrives as
 *
 *     by five hundred dollars of soul, sell a third at two x,
 *     stop the rest at fifty percent
 *
 * which parses to null, and voice looks broken when in fact the compiler is
 * doing exactly its job.
 *
 * THE RULE THIS FILE FOLLOWS: it rewrites form, never meaning. Every
 * transformation here is one a stenographer would make — a number word into a
 * digit, "percent" into "%", a homophone into the word that is a real trading
 * term. It never guesses at an amount, a side, or a token that was not said.
 * When it cannot tell, it leaves the words alone and the grammar refuses,
 * which is the outcome we want: a refusal costs one retry, a wrong guess that
 * reads plausibly in the readback costs a position.
 *
 * Pure and offline, so it is testable without a microphone.
 *
 * It runs on typed input too. "buy 500 dollars of sol" is a perfectly normal
 * thing to type and the grammar rejects it today for want of a $.
 */

/* Ones and teens. */
const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19,
};

const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90,
};

/** Multipliers. "grand" and "k" both mean a thousand out loud. */
const SCALES: Record<string, number> = {
  hundred: 100, thousand: 1_000, grand: 1_000, million: 1_000_000,
  billion: 1_000_000_000,
};

/**
 * Homophones, fixed only where the wrong word is not itself a trading term.
 *
 * "by" → "buy" is safe because "by" never begins an order. "soul"/"sole" →
 * "sol" is safe because this app trades one market; it is exactly the kind of
 * assumption that stops being safe the moment a second token exists.
 *
 * cipher: hardcoded to SOL. Multi-token means resolving the spoken word
 * against the tradeable list instead, and refusing on an ambiguous match.
 */
const HOMOPHONES: Record<string, string> = {
  bye: "buy", "buy-in": "buy",
  soul: "sol", sole: "sol", saul: "sol", sal: "sol", salt: "sol",
  cell: "sell", sale: "sell",
  bok: "bonk", bonked: "bonk",
  slippage: "slippage", slipage: "slippage",
};

const isNumberWord = (w: string) =>
  w in UNITS || w in TENS || w in SCALES || w === "point";

/**
 * Collapse a run of number words into digits.
 *
 * Standard accumulator: units and tens add into the current group, "hundred"
 * multiplies it, and a big scale ("thousand", "million") flushes the group
 * into the total. "one thousand five hundred" is 1500, not 1000 then 500.
 *
 * "point" switches to decimals, so "two point five" is 2.5.
 */
function wordsToNumber(words: string[]): number | null {
  let total = 0;
  let current = 0;
  let seen = false;
  let decimals: string | null = null;

  for (const w of words) {
    if (w === "point") {
      decimals = "";
      continue;
    }
    if (decimals !== null) {
      // After "point", every digit is spoken alone: "five" then "one" is .51
      if (!(w in UNITS)) return null;
      decimals += String(UNITS[w]);
      continue;
    }
    if (w in UNITS) {
      current += UNITS[w];
      seen = true;
    } else if (w in TENS) {
      current += TENS[w];
      seen = true;
    } else if (w === "hundred") {
      current = (current || 1) * 100;
      seen = true;
    } else if (w in SCALES) {
      total += (current || 1) * SCALES[w];
      current = 0;
      seen = true;
    } else {
      return null;
    }
  }

  if (!seen) return null;
  const whole = total + current;
  return decimals ? Number(`${whole}.${decimals}`) : whole;
}

/**
 * Rewrite every run of number words in a sentence as digits.
 *
 * Done as a scan rather than a regex because a number is a *sequence* of
 * words whose length is not known in advance, and "a" only counts as one when
 * a scale word follows it — "a hundred" is 100, but "a third" is a fraction
 * the grammar already understands and must not be touched.
 */
function digitiseNumbers(text: string): string {
  const words = text.split(/\s+/);
  const out: string[] = [];

  for (let i = 0; i < words.length; ) {
    const bare = words[i].replace(/[^a-z0-9.]/g, "");
    const leadingArticle = (bare === "a" || bare === "an") && isNumberWord(
      (words[i + 1] ?? "").replace(/[^a-z]/g, ""),
    ) && (words[i + 1] ?? "").replace(/[^a-z]/g, "") in SCALES;

    if (!isNumberWord(bare) && !leadingArticle) {
      out.push(words[i]);
      i += 1;
      continue;
    }

    // Take the longest run of number words starting here.
    let j = leadingArticle ? i + 1 : i;
    const run: string[] = [];
    while (j < words.length) {
      const w = words[j].replace(/[^a-z]/g, "");
      if (!isNumberWord(w)) break;
      run.push(w);
      j += 1;
    }

    /*
     * "ONE TWENTY" IS 120, the way prices are said out loud — "one twenty",
     * "two fifty", "one twenty five". The accumulator added them (1 + 20 =
     * 21), so "a target price of one twenty dollars" armed a sell at $21:
     * a target the user placed above the market became a stop far below it.
     * A single digit followed directly by a tens word is never how anyone
     * says 21 ("twenty one" is), so it is always hundreds.
     */
    const u = UNITS[run[0]];
    const n =
      run.length >= 2 && u >= 1 && u <= 9 && run[1] in TENS
        ? (() => {
            const rest = wordsToNumber(run.slice(1));
            return rest === null ? null : u * 100 + rest;
          })()
        : wordsToNumber(run);
    if (n === null) {
      out.push(words[i]);
      i += 1;
      continue;
    }

    /* Punctuation that ended the run travels with the number, or "fifty
       percent, stop the rest" loses its comma and the clauses merge. */
    const tail = words[j - 1].match(/[^a-z0-9]+$/)?.[0] ?? "";
    out.push(String(n) + tail);
    i = j;
  }

  return out.join(" ");
}

/**
 * The whole pipeline, in the order the steps depend on each other.
 *
 * Numbers become digits first, because every rule after this one matches
 * against a digit: "$" has to attach to a number, "%" has to follow one, and
 * "x" has to be multiplied by one.
 */
export function normaliseSpeech(raw: string): string {
  let t = ` ${raw.toLowerCase().trim()} `;

  // Filler that recognisers faithfully transcribe and the grammar chokes on.
  t = t.replace(/\b(?:um|uh|erm|like|please|okay|ok|hey|yo)\b/g, " ");

  // Homophones, whole words only.
  t = t.replace(/\b[a-z-]+\b/g, (w) => HOMOPHONES[w] ?? w);

  /*
   * "BY" → "BUY" ONLY WHERE AN ORDER COULD START, which is what the note on
   * HOMOPHONES always claimed and the code did not do.
   *
   * It sat in the table and rewrote every "by" in the sentence, so "trail my
   * sol by 40%" became "trail my sol buy 40%" and stopped parsing — and this
   * runs on TYPED text as well as spoken, so it broke a sentence nobody
   * dictated. "By" is a perfectly ordinary preposition in the middle of an
   * instruction: trail BY 40%, stop BY 20%, down BY half.
   *
   * At the front of the string or the front of a clause it is the transcriber
   * mishearing the verb, which is the case this exists for and the only one.
   *
   * `^\s*` rather than `^`, because the pipeline pads the string with a space
   * at both ends so that every `\b` rule after it has something to anchor
   * against. A bare `^` matches the pad and never the word.
   */
  t = t.replace(/(^\s*|[,;]\s*|\b(?:and|then)\s+)by\b/g, "$1buy");

  t = digitiseNumbers(t);

  // "five hundred dollars" → "$500". Also "bucks", and "usd" as spoken.
  t = t.replace(/\b(\d[\d.,]*)\s*(?:dollars?|bucks?|usd|usdc)\b/g, "$$$1");

  // "fifty percent" → "50%".
  t = t.replace(/\b(\d[\d.]*)\s*(?:percent|per cent|pct)\b/g, "$1%");

  /* "two x", "two times", "double" → "2x". The recogniser writes the bare
     letter as "x" or "ex" depending on how it was said. */
  t = t.replace(/\b(\d[\d.]*)\s*(?:x|ex|times)\b/g, "$1x");
  t = t.replace(/\bdoubles?\b/g, "2x");
  t = t.replace(/\btriples?\b/g, "3x");

  // Spoken signs. The grammar ignores a stop's sign, but "-50%" is what a
  // person means and what they will read back in the confirmation.
  t = t.replace(/\b(?:minus|negative|down)\s+(?=[\d$])/g, "-");

  // "k" and "m" spoken after a digit: "five k" is already "5000" via SCALES,
  // but "5 k" typed or transcribed as a letter needs closing up.
  t = t.replace(/\b(\d[\d.]*)\s+([km])\b/g, "$1$2");

  // Recognisers punctuate generously; the grammar reads clause order, not
  // sentences, and a full stop mid-order splits nothing useful.
  t = t.replace(/[.](?=\s|$)/g, " ");

  return t.replace(/\s+/g, " ").trim();
}
