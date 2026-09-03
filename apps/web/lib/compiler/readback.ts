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
      if (a.value === 100) return "everything";
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
    const { side, amount: amt, slippageBps, privateSubmission } = spec.entry;

    lines.push({
      label: side === "buy" ? "BUY" : "SELL",
      value: `${amount(amt, token)} of ${token?.toUpperCase()}`,
      note: spec.entry.mint ? undefined : "token not confirmed yet",
    });

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
