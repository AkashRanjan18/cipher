"use client";

import { marketOf } from "@/lib/market";
import { usd } from "@/lib/format";
import { useTriggers } from "@/lib/triggers/store";
import type { Amount, Rule } from "@cipher/shared";

/**
 * What is being watched, and what already happened.
 *
 * The Alerts tab said "when the trigger engine lands, every armed rule reports
 * here". It landed. This is that.
 *
 * Two lists, and the split is deliberate: what is still waiting is a thing the
 * user can act on, so it gets the cancel button and the top of the panel.
 * History is evidence — it answers "why did you sell my SOL", which is the
 * question that matters most and the one an app like this must never fumble.
 */

/** "a third", "$500", "1.5 SOL" — the instruction, not the arithmetic. */
function amountLabel(amount: Amount, base: string): string {
  switch (amount.kind) {
    case "usd":
      return `${usd(amount.value)} of ${base}`;
    case "tokens":
      return `${amount.value} ${base}`;
    case "percentOfPosition":
      // "all of your SOL" / "50% of your SOL" — the label is completed by the
      // caller with the market, so it must not name a position of its own.
      return amount.value === 100 ? `all of your ${base}` : `${amount.value}% of your ${base}`;
  }
}

function triggerLabel(rule: Rule): string {
  switch (rule.trigger.kind) {
    case "priceMultiple":
      return `at ${rule.trigger.value}x`;
    case "priceAbsolute":
      return `when ${marketOf(rule.market).base} reaches ${usd(rule.trigger.value)}`;
    case "drawdownFromEntry":
      return `if it falls ${rule.trigger.percent}% from entry`;
    case "trailingStop":
      return `${rule.trigger.percent}% below the high`;
    case "timeAbsolute":
      return `at ${new Date(rule.trigger.iso).toLocaleString()}`;
    case "duration":
      return `${Math.round(rule.trigger.seconds / 60)} minutes after it fills`;
  }
}

export function AlertsList() {
  const { armed, rulesById, transitions, hydrated, cancelRule, thresholdOf } = useTriggers();

  if (!hydrated) {
    return <div className="p-4 font-sans text-[11.5px] text-mute">Reading your rules…</div>;
  }

  const history = [...transitions]
    .filter((t) => t.to === "filled" || t.to === "expired" || t.to === "failed")
    .reverse()
    .slice(0, 25);

  if (armed.length === 0 && history.length === 0) {
    return (
      <p className="p-4 text-center font-sans text-[11.5px] leading-relaxed text-ash">
        Nothing armed. Tell Sana something like{" "}
        <span className="text-champagne">&ldquo;sell half at 2x, stop the rest at -50%&rdquo;</span>{" "}
        and it will appear here, watching.
      </p>
    );
  }

  return (
    <div className="flex flex-col">
      {armed.length > 0 && (
        <>
          <Heading>Watching</Heading>
          {armed.map((rule) => {
            const base = marketOf(rule.market).base;
            const at = thresholdOf(rule);
            return (
              <div
                key={rule.id}
                className="border-b border-hairline px-2.5 py-2 last:border-0"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-sans text-[12px] font-bold text-champagne">
                      {rule.side === "buy" ? "Buy" : "Sell"} {amountLabel(rule.amount, base)}
                    </div>
                    <div className="font-sans text-[10.5px] leading-tight text-ash">
                      {triggerLabel(rule)}
                      {at !== null && (
                        <span className="text-mute"> · {usd(at)}</span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => cancelRule(rule.id)}
                    className="shrink-0 rounded-md px-1.5 py-0.5 font-sans text-[10px] font-bold text-mute transition-colors hover:bg-slate hover:text-down"
                  >
                    cancel
                  </button>
                </div>
                {/*
                  * The honest disclaimer, and it stays until a server watches.
                  *
                  * Everything about an armed rule implies a promise that it
                  * will fire. In this version it fires only while the page is
                  * open, and a user who closes the tab expecting a stop to
                  * hold is exactly the person this product must not create.
                  */}
                <div className="mt-1 font-sans text-[9.5px] leading-tight text-mute">
                  Watched while this tab is open.
                </div>
              </div>
            );
          })}
        </>
      )}

      {history.length > 0 && (
        <>
          <Heading>History</Heading>
          {history.map((t, i) => {
            /*
             * The rule, not just the transition.
             *
             * A transition on its own reads "executed", which is true and
             * useless. The line has to name the instruction the user gave, or
             * this panel cannot answer the only question it exists for.
             */
            const rule = rulesById[t.ruleId];
            const base = rule ? marketOf(rule.market).base : null;
            return (
              <div
                key={`${t.ruleId}-${t.at}-${i}`}
                className="border-b border-hairline px-2.5 py-1.5 last:border-0"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span
                    className={`min-w-0 truncate font-sans text-[11.5px] ${
                      t.to === "filled" ? "text-up" : t.to === "failed" ? "text-down" : "text-ash"
                    }`}
                  >
                    {rule && base
                      ? `${
                          t.to === "filled"
                            ? rule.side === "buy"
                              ? "Bought"
                              : "Sold"
                            : t.to === "expired"
                              ? "Expired"
                              : "Failed"
                        } ${amountLabel(rule.amount, base)}`
                      : t.reason}
                  </span>
                  <span className="shrink-0 font-mono text-[9.5px] text-mute">
                    {new Date(t.at).toLocaleTimeString()}
                  </span>
                </div>
                {rule && (
                  <div className="font-sans text-[10px] leading-tight text-mute">
                    {triggerLabel(rule)}
                    {t.price !== undefined && ` · filled at ${usd(t.price)}`}
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-slate px-2.5 py-1 font-sans text-[9.5px] font-bold uppercase tracking-[0.11em] text-ash">
      {children}
    </div>
  );
}
