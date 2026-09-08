"use client";

import { useEffect, useRef, useState } from "react";
import type { OrderSpec } from "@cipher/shared";
import { parseWithGrammar } from "@/lib/compiler/grammar";
import { readback, type ReadbackLine } from "@/lib/compiler/readback";
import { usePaperAccount } from "@/lib/account/store";
import { resolveQty, allInPrice } from "@/lib/account/paper";
import { usd } from "@/lib/format";

/**
 * Polly — the conversational bar along the bottom.
 *
 * Parrot's shape, with one substitution that matters: it drives the REAL
 * compiler in lib/compiler, not the regex Parrot shipped. So an order card
 * here is the same OrderSpec and the same readback that would arm a rule,
 * rather than a mock that agrees with itself.
 *
 * The consequence is that Polly refuses more than Parrot's version did. The
 * grammar returns null rather than half-parsing, because a partial readback
 * looks plausible and gets approved — and approving a misread order is the
 * one failure this product cannot have.
 */

interface Turn {
  id: number;
  mine: boolean;
  text: string;
  /** Present when the sentence compiled into an order. */
  lines?: ReadbackLine[];
  /** The spec behind those lines, so approving can execute the exact thing shown. */
  spec?: OrderSpec;
  /** Set once the user has answered the card, so it stops asking. */
  resolved?: string;
}

const COMMANDS: [string, string][] = [
  ["/buy", "Buy an amount of SOL"],
  ["/sell", "Sell part or all of your position"],
  ["/copy", "Mirror a friend's trades"],
  ["/flock", "See what your flocks are holding"],
  ["/squawk", "Post a note to your flock"],
  ["/help", "What Polly understands"],
];

let nextId = 0;

export function Polly({ price }: { price: number | undefined }) {
  const { account, trade } = usePaperAccount();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [slashOpen, setSlashOpen] = useState(false);
  const streamRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Newest turn should be visible without scrolling for it.
  useEffect(() => {
    streamRef.current?.scrollTo({ top: streamRef.current.scrollHeight });
  }, [turns]);

  // "/" anywhere focuses the bar, the way every terminal does it.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      if (e.key === "/") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function push(t: Omit<Turn, "id">) {
    setTurns((prev) => [...prev, { ...t, id: nextId++ }]);
  }

  function handle(raw: string) {
    const text = raw.trim();
    if (!text) return;
    push({ mine: true, text });

    const low = text.toLowerCase();

    if (low === "/help" || low === "help") {
      push({
        mine: false,
        text:
          "Type it the way you'd say it — \"buy $500 of SOL, sell a third at 2x, stop the rest at -50%\". " +
          "Anything that moves money comes back as a card you have to approve first, and " +
          "approving it really does trade your paper balance. " +
          "I refuse rather than guess: if I only half-understood, you get nothing instead of a plausible-looking order.",
      });
      return;
    }

    if (low.startsWith("/flock")) {
      push({
        mine: false,
        text:
          "Chart Goblins is up $182K this week, Slow Money $41K. Three of your flock are long SOL right now, " +
          "$720 between them. All of it small.",
      });
      return;
    }

    if (low.startsWith("/copy")) {
      const who = low.match(/@?\b(mochi|vex|unipcs|crayon|ogle|salem|kaito)\b/)?.[1];
      push({
        mine: false,
        text: who
          ? `Copying @${who} would mirror their trades at your size, not theirs, capped per trade. There's no copy engine wired up yet — this is the shape it takes.`
          : "Name someone to copy — /copy @mochi.",
      });
      return;
    }

    /*
     * Everything else goes to the grammar. It handles the sentences people
     * actually type, in under 10ms with no network and no chance of a misread.
     * When it returns null the model would take over — that route is not
     * built yet, so Polly says so rather than pretending.
     */
    const spec = parseWithGrammar(text.replace(/^\/(buy|sell)\s*/i, "$1 "));

    if (!spec) {
      push({
        mine: false,
        text:
          "I didn't fully understand that, so I'm not going to guess. Try naming the amount and the token — " +
          "\"buy $250 of SOL\" — and add the exits after it if you want them.",
      });
      return;
    }

    push({
      mine: false,
      text: "I read that as an order. Check it before it goes anywhere.",
      lines: readback(spec),
      spec,
    });
  }

  function resolve(id: number, answer: string) {
    setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, resolved: answer } : t)));
  }

  /*
   * Approving a card executes its ENTRY against the paper account, using the
   * same engine the ticket uses, so a sentence and a button press are the
   * same trade.
   *
   * The exits are deliberately not armed. There is no trigger engine yet, and
   * a card that says "stop set at -50%" when nothing is watching the price is
   * the single worst lie this product could tell — the user would size the
   * position believing they are protected. So the entry fills and Polly says
   * plainly that the exits did not arm.
   */
  function approve(t: Turn) {
    const entry = t.spec?.entry;
    if (!entry || !price) {
      resolve(t.id, "No live price to fill against. Nothing happened.");
      return;
    }

    const qty = resolveQty(entry.amount, entry.side, account, price);
    if (qty === null) {
      resolve(t.id, `I can't turn "${entry.amount.kind}" into a ${entry.side} size. Nothing happened.`);
      return;
    }

    const r = trade({ side: entry.side, qty, mark: price, source: "polly" });
    if ("refusal" in r) {
      resolve(t.id, r.refusal);
      return;
    }

    const exits = t.spec!.exits.length;
    resolve(
      t.id,
      `Filled ${r.fill.qty.toFixed(4)} SOL at ${usd(allInPrice(r.fill))}.` +
        (exits
          ? ` The ${exits === 1 ? "exit" : `${exits} exits`} did NOT arm — there is no trigger engine yet, so nothing is watching the price. You are unhedged.`
          : ""),
    );
  }

  return (
    <div className="flex shrink-0 flex-col rounded-2xl border border-line bg-panel px-3 pb-3">
      {turns.length > 0 && (
        <div
          ref={streamRef}
          aria-live="polite"
          className="flex max-h-[196px] flex-col gap-2.5 overflow-y-auto py-3"
        >
          {turns.map((t) =>
            t.mine ? (
              <p
                key={t.id}
                className="self-end rounded-2xl rounded-br-sm bg-raised px-3 py-1.5 font-sans text-[12.5px] text-champagne"
              >
                {t.text}
              </p>
            ) : (
              <div key={t.id} className="flex gap-2.5">
                <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent text-[11px]">
                  🦜
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-sans text-[12.5px] leading-relaxed text-ash">
                    {t.text}
                  </p>

                  {t.lines && (
                    <div className="mt-2 rounded-xl border border-accent/40 bg-accent/10 p-3">
                      <dl className="flex flex-col gap-1">
                        {t.lines.map((l) => (
                          <div key={l.label} className="flex flex-wrap gap-x-3 font-mono text-[11.5px]">
                            <dt className="w-20 shrink-0 text-ash">{l.label}</dt>
                            <dd className="text-champagne">{l.value}</dd>
                            {l.note && <dd className="text-ash">— {l.note}</dd>}
                          </div>
                        ))}
                      </dl>

                      {t.resolved ? (
                        <p className="mt-2.5 font-sans text-[11.5px] text-champagne">
                          {t.resolved}
                        </p>
                      ) : (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            onClick={() => approve(t)}
                            className="rounded-lg bg-accent px-3.5 py-2 font-sans text-[12.5px] font-bold text-ink hover:brightness-110"
                          >
                            Yep, do it
                          </button>
                          <button
                            onClick={() => resolve(t.id, "Dropped it. Nothing happened.")}
                            className="rounded-lg border border-line px-3.5 py-2 font-sans text-[12.5px] font-bold text-ash hover:border-ash hover:text-champagne"
                          >
                            Never mind
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ),
          )}
        </div>
      )}

      <div className="relative">
        {slashOpen && (
          <div
            role="listbox"
            className="absolute bottom-full left-0 z-20 mb-1 w-full max-w-[440px] overflow-hidden rounded-xl border border-line bg-slate shadow-2xl"
          >
            {COMMANDS.filter(([c]) => c.startsWith(input.toLowerCase())).map(([c, d]) => (
              <button
                key={c}
                onClick={() => {
                  setInput(c + " ");
                  setSlashOpen(false);
                  inputRef.current?.focus();
                }}
                className="flex w-full items-baseline gap-3 px-3 py-2 text-left hover:bg-raised"
              >
                <code className="w-16 shrink-0 font-mono text-[11.5px] text-accent">{c}</code>
                <span className="font-sans text-[11.5px] text-ash">{d}</span>
              </button>
            ))}
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            setSlashOpen(false);
            handle(input);
            setInput("");
          }}
          className="flex items-center gap-2.5 rounded-xl border border-line bg-slate py-2 pl-3 pr-2 focus-within:border-accent focus-within:ring-4 focus-within:ring-accent/15"
        >
          <span className="shrink-0 rounded-lg bg-raised px-2 py-1 font-mono text-[11px] text-ash">
            <b className="font-medium text-champagne">SOL</b>/USDT
          </span>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setSlashOpen(e.target.value.startsWith("/") && !e.target.value.includes(" "));
            }}
            onKeyDown={(e) => e.key === "Escape" && setSlashOpen(false)}
            placeholder="Ask Polly, place a trade, or /copy a friend"
            aria-label="Ask Polly or type a command"
            className="min-w-0 flex-1 bg-transparent font-sans text-sm text-champagne placeholder:text-ash focus:outline-none"
          />
          <span className="shrink-0 font-mono text-[10.5px] text-ash">⏎</span>
          <button
            type="submit"
            aria-label="Send to Polly"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent text-ink hover:brightness-110"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8">
              <path d="M5 12h13M12 5.5l6.5 6.5-6.5 6.5" />
            </svg>
          </button>
        </form>
      </div>

      <div className="flex flex-wrap gap-4 px-1 pt-2 font-sans text-[10.5px] text-ash">
        <span>
          Live Binance prices, <b className="text-champagne">paper money</b>. Handles and
          squawks around them are placeholder.
        </span>
        <span>
          Hit <b className="text-champagne">/</b> anywhere to talk to Polly.
        </span>
      </div>
    </div>
  );
}
