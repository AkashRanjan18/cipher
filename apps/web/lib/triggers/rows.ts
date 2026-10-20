import { newId, type ExitRule } from "@cipher/shared";

/**
 * THE TICKET'S EXIT ROWS — Axiom's "Advanced Trading Strategy", in cipher.
 *
 * The user's call, 21 Oct 2026, pointing at Axiom's ticket: a stop loss, a
 * trailing stop or a target, each with its own slice of the position, and an
 * Add button to stack more. That is a ladder, and the engine has fired ladders
 * since September — what was missing was a way to say one with the mouse.
 *
 * PERCENTAGES FIRST, PRICES ALLOWED. Axiom's rows are "-10%" because that is
 * how a trader thinks about a stop before they know their fill, and because a
 * percentage survives the fill coming in a little high or low. A plain number
 * is read as a percent; a number with a $ is read as a price. One rule, said
 * in the placeholder, and no mode switch to get wrong.
 *
 * WHY A PERCENT TARGET BECOMES A MULTIPLE, NOT A PRICE. "+50%" compiles to
 * priceMultiple 1.5, which the engine resolves against the ACTUAL fill when
 * the buy lands. Computing a price here would freeze it against the estimate
 * on screen, and on a thin token the two differ by more than the stop does.
 *
 * Pure, so it is tested without a browser. The React is in ticket.tsx.
 */

export type RowKind = "sl" | "tp" | "tsl";

export interface Row {
  kind: RowKind;
  /** "-10", "10%", "$120" — as typed. */
  value: string;
  /** Percent of the position this row sells. Blank means all of it. */
  amount: string;
}

export const EMPTY_ROW: Row = { kind: "sl", value: "", amount: "" };

export const ROW_LABEL: Record<RowKind, string> = {
  sl: "Stop loss",
  tp: "Target",
  tsl: "Trailing",
};

export interface Parsed {
  /** Ready to arm. Empty when nothing is filled in. */
  rules: ExitRule[];
  /** Blocks the trade: said next to the button, never swallowed. */
  problem: string | null;
  /** Does not block: the ladder that needs more tokens than it will have. */
  warning: string | null;
  /** One line for the receipt: "Stop loss -10% on 50%, target 2× on 50%." */
  summary: string;
}

const num = (s: string): number | null => {
  const n = Number(s.replace(/[$,%\s]/g, ""));
  return Number.isFinite(n) ? Math.abs(n) : null;
};

/**
 * Rows → exit rules, with everything that is wrong about them said out loud.
 *
 * `entryRef` is where the buy is expected to fill: the limit price when it
 * rests, the market price when it fills now. It is only used to check that an
 * ABSOLUTE price sits on the right side of the entry — a stop above it, or a
 * target below it, would fire the instant the buy landed.
 */
export function parseRows(rows: Row[], entryRef: number): Parsed {
  const rules: ExitRule[] = [];
  const said: string[] = [];
  let problem: string | null = null;
  let targetShare = 0;

  for (const row of rows) {
    const raw = row.value.trim();
    if (!raw) continue;

    const value = num(raw);
    if (value === null || value <= 0) {
      problem ??= `${ROW_LABEL[row.kind]}: "${raw}" is not a number.`;
      continue;
    }

    /* A price, only when the user marked it one. Everything else is a
       percentage — the Axiom default, and the one that survives the fill. */
    const isPrice = raw.includes("$");

    const share = row.amount.trim() ? num(row.amount) : 100;
    if (share === null || share <= 0 || share > 100) {
      problem ??= `${ROW_LABEL[row.kind]}: the amount has to be between 1% and 100%.`;
      continue;
    }
    const amount = { kind: "percentOfPosition" as const, value: share };
    const slice = share === 100 ? "" : ` on ${share}%`;

    if (row.kind === "tsl") {
      if (isPrice) {
        problem ??= "A trailing stop is a percentage off the high, not a price.";
        continue;
      }
      if (value >= 100) {
        problem ??= "A trailing stop has to be under 100%.";
        continue;
      }
      rules.push({ id: newId("r"), trigger: { kind: "trailingStop", percent: value }, amount });
      said.push(`trailing ${value}%${slice}`);
      continue;
    }

    if (row.kind === "sl") {
      if (isPrice) {
        if (entryRef > 0 && value >= entryRef) {
          problem ??= `A stop loss has to be below ${money(entryRef)}.`;
          continue;
        }
        rules.push({ id: newId("r"), trigger: { kind: "priceAbsolute", value }, amount });
        said.push(`stop ${money(value)}${slice}`);
      } else {
        if (value >= 100) {
          problem ??= "A stop loss has to be less than 100% below your entry.";
          continue;
        }
        rules.push({ id: newId("r"), trigger: { kind: "drawdownFromEntry", percent: value }, amount });
        said.push(`stop −${value}%${slice}`);
      }
      continue;
    }

    /* A target. Percent becomes a MULTIPLE so it binds to the real fill. */
    targetShare += share;
    if (isPrice) {
      if (entryRef > 0 && value <= entryRef) {
        problem ??= `A target has to be above ${money(entryRef)}.`;
        continue;
      }
      rules.push({ id: newId("r"), trigger: { kind: "priceAbsolute", value }, amount });
      said.push(`target ${money(value)}${slice}`);
    } else {
      rules.push({
        id: newId("r"),
        trigger: { kind: "priceMultiple", value: 1 + value / 100 },
        amount,
      });
      said.push(`target +${value}%${slice}`);
    }
  }

  /*
   * A LADDER THAT ADDS PAST THE POSITION. Not refused: percentages freeze into
   * token counts when the order is placed, so the last rung simply waits for
   * tokens that will not arrive — harmless, and buying more would wake it.
   * Said anyway, because a rung that never fires should never be a surprise.
   */
  const warning =
    targetShare > 100
      ? `Your targets add up to ${Math.round(targetShare)}% of the position, so the last one waits until you hold that much.`
      : null;

  return {
    rules,
    problem,
    warning,
    summary: said.length ? ` ${capitalise(said.join(", "))} set.` : "",
  };
}

const money = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 6 })}`;
const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
