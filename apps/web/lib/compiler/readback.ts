import { DEFAULTS, type Amount, type ExitRule, type OrderSpec, type Trigger } from "@cipher/shared";

/**
 * Spec → plain English.
 *
 * This is the trust surface. The user approves what this renders, not what
 * they typed, and everything downstream executes the spec — so if the
 * readback and the spec ever disagree, the user has approved a lie.
 *
 * Two rules govern every line here:
 *
 *   1. Render the SPEC, never the input. Echoing the sentence back would
 *      always look correct and would catch nothing.
 *   2. State consequences, not parameters. "3% slippage" is a setting;
 *      "aborts if the price moves more than 3%" is what will happen. The
 *      user cannot verify a number they do not understand.
 *
 * Returns structured lines rather than a string so the panel can style them
 * and tests can assert on them without parsing prose.
 */

export interface ReadbackLine {
  label: string;
  value: string;
  /** The consequence. What actually happens, in the user's terms. */
  note?: string;
}

const nf = new Intl.NumberFormat("en-US");

function money(n: number): string {
  return `$${nf.format(n)}`;
}

/** Percentages people said in words go back out in words. */
function amount(a: Amount, token?: string): string {
  switch (a.kind) {
    case "usd":
      return money(a.value);
    case "tokens":
      return `${nf.format(a.value)}${token ? ` ${token.toUpperCase()}` : ""}`;
    case "percentOfPosition":
      /*
       * "whatever is left", not "everything".
       *
       * "sell half at 2x, stop THE REST at -30%" compiles the stop to 100% of
       * the position, which is correct — a percentage resolves at FIRE time,
       * so once the take-profit has sold half, 100% of what remains is exactly
       * "the rest". But reading it back as "sell everything" loses the user's
       * own word and reads like cipher misunderstood and is about to dump the
       * lot. Both phrasings mean the same thing at fire time, and this is the
       * phrase that is true for both.
       */
      if (a.value === 100) return "whatever is left";
      if (a.value === 50) return "half";
      if (a.value === 33) return "a third";
      if (a.value === 25) return "a quarter";
      return `${a.value}%`;
  }
}

function trigger(t: Trigger): { value: string; note?: string } {
  switch (t.kind) {
    case "priceMultiple":
      return {
        value: `at ${t.value}× your entry`,
        note: "measured from the price you actually fill at",
      };
    case "priceAbsolute":
      return { value: `at ${money(t.value)}` };
    case "drawdownFromEntry":
      return {
        value: `if it falls ${t.percent}% below your entry`,
        note: "fires once — it does not follow the price up",
      };
    case "trailingStop":
      return {
        value: `if it falls ${t.percent}% from its high`,
        note: "the high resets if you exit the position completely",
      };
    case "timeAbsolute":
      return {
        value: `on ${new Date(t.iso).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric",
        })}`,
        note: "time-based, so a price gap cannot skip it",
      };
    case "duration": {
      const days = Math.round(t.seconds / 86_400);
      const hours = Math.round(t.seconds / 3_600);
      return {
        value: days >= 1 ? `after ${days} day${days === 1 ? "" : "s"}` : `after ${hours}h`,
        note: "time-based, so a price gap cannot skip it",
      };
    }
  }
}

function exitLine(rule: ExitRule, token?: string): ReadbackLine {
  const t = trigger(rule.trigger);
  const isStop =
    rule.trigger.kind === "drawdownFromEntry" || rule.trigger.kind === "trailingStop";

  return {
    label: isStop ? "STOP" : "THEN",
    value: `sell ${amount(rule.amount, token)} ${t.value}`,
    note: t.note,
  };
}

export function readback(spec: OrderSpec): ReadbackLine[] {
  const lines: ReadbackLine[] = [];
  const token = spec.entry?.token;

  if (spec.entry) {
    const { side, amount: amt, slippageBps, privateSubmission, priority, tipSol } = spec.entry;

    /*
     * "1 SOL of SOL" — the token was being named twice.
     *
     * A token-denominated amount already carries the ticker, so appending
     * "of SOL" repeats it. A dollar or percentage amount does not, and needs
     * it. Reads as "$500 of SOL" and "1 SOL".
     */
    lines.push({
      label: side === "buy" ? "BUY" : "SELL",
      value:
        amt.kind === "tokens"
          ? amount(amt, token)
          : `${amount(amt, token)} of ${token?.toUpperCase()}`,
      note: spec.entry.mint ? undefined : "token not confirmed yet",
    });

    /*
     * A resting entry says so on its own line, above everything else.
     *
     * Without it the receipt for a limit order is indistinguishable from the
     * receipt for a market order — the same BUY line, the same amount — and
     * the only thing saying "this has not traded" is a sentence above the
     * card. The line the eye lands on has to carry it.
     */
    if (spec.entry.trigger) {
      lines.push({
        label: "WHEN",
        value: trigger(spec.entry.trigger).value.replace(/^at /, "it reaches "),
        note: "rests until then — nothing trades now",
      });
    }

    /*
     * Slippage and routing only appear when the user actually said something.
     * At their defaults they are noise: a reader who did not mention slippage
     * cannot meaningfully approve a slippage line, and every line they skim
     * past makes the lines that matter cheaper.
     *
     * The capability stays — "max 1% slippage" still parses and still shows.
     * Non-default routing always shows, because going public is a real
     * downgrade and silence would hide it.
     */
    if (slippageBps !== DEFAULTS.slippageBps) {
      lines.push({
        label: "SLIPPAGE",
        value: `up to ${slippageBps / 100}%`,
        note: "the order is abandoned rather than filled worse than this",
      });
    }

    if (!privateSubmission) {
      lines.push({
        label: "ROUTING",
        value: "public",
        note: "visible in the public mempool before it lands — you can be front-run",
      });
    }

    /*
     * The other two knobs, on the same rule: shown when asked for, silent at
     * their defaults. Both cost real money, so a reader who said "turbo" has
     * to see it on the card they are approving — and one who said nothing
     * should not be asked to approve a line about fee levels.
     */
    if (priority !== DEFAULTS.priority) {
      lines.push({
        label: "PRIORITY",
        value: priority,
        note:
          priority === "turbo"
            ? "pays well over the odds to land in the next block"
            : "pays above the going rate to land sooner",
      });
    }

    if (tipSol != null) {
      lines.push({
        label: "TIP",
        value: `${tipSol} SOL`,
        note: "bid to the block builder, on top of the fee — paid whether or not you profit",
      });
    }
  }

  for (const rule of spec.exits) lines.push(exitLine(rule, token));

  /*
   * Say plainly when nothing will happen without them. A spec with an entry
   * and no exits is legitimate, but the user should know they are back to
   * watching the chart themselves.
   */
  if (spec.entry && spec.exits.length === 0) {
    lines.push({
      label: "AFTER",
      value: "nothing",
      note: "no exit is armed — this position will not sell itself",
    });
  }

  return lines;
}

/** Flat text, for tests and for logging what a user approved. */
export function readbackText(spec: OrderSpec): string {
  return readback(spec)
    .map((l) => `${l.label} ${l.value}${l.note ? ` (${l.note})` : ""}`)
    .join("\n");
}
