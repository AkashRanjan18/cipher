"use client";

import { useEffect, useRef, useState } from "react";
import { baseSymbol, mintFor } from "@/lib/chain/markets";
import { newId } from "@cipher/shared";
import type { Compiled, CompileContext, Intent, Interval, OrderSpec } from "@cipher/shared";
import { compile } from "@/lib/compiler/compile";
import { compileWithModel } from "@/lib/compiler/model";
import { resolveMarket, marketOf, type Major } from "@/lib/market";
import { validateOrder, blocks } from "@/lib/compiler/validate";
import { readback, type ReadbackLine } from "@/lib/compiler/readback";
import { usePaperAccount } from "@/lib/account/store";
import { useTriggers } from "@/lib/triggers/store";
import { useSpeech } from "@/lib/voice/use-speech";
import { normaliseSpeech } from "@/lib/voice/normalise";
import { resolveQty, allInPrice,
  positionOf,
  heldMints,
} from "@/lib/account/paper";
import { usd, compactUsd, pct } from "@/lib/format";
import { equity, unrealised } from "@/lib/account/paper";

/**
 * Sana — the conversational bar along the bottom.
 *
 * Parrot's shape, with one substitution that matters: it drives the REAL
 * compiler in lib/compiler, not the regex Parrot shipped. So an order card
 * here is the same OrderSpec and the same readback that would arm a rule,
 * rather than a mock that agrees with itself.
 *
 * The consequence is that Sana refuses more than Parrot's version did. The
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
  /** Non-blocking notes from the validator. Shown on the card, never hidden. */
  warnings?: string[];
  /**
   * An ambiguity, with the sentence rewritten each way.
   *
   * Picking one re-runs the whole compiler on that sentence rather than
   * patching a half-parsed spec — see ClarifyIntent for why that matters.
   */
  choices?: { label: string; sentence: string }[];
  /** A placeholder while the model is being asked. Replaced by the answer. */
  thinking?: boolean;
  /** Set once the user has answered the card, so it stops asking. */
  resolved?: string;
}

const COMMANDS: [string, string][] = [
  ["/buy", "Buy an amount of SOL"],
  ["/sell", "Sell part or all of your position"],
  ["/copy", "Mirror a friend's trades"],
  ["/flock", "See what your flocks are holding"],
  ["/squawk", "Post a note to your flock"],
  ["/help", "What Sana understands"],
];

let nextId = 0;

export function Sana({
  price,
  market = "SOL",
  symbol,
  interval,
  majors,
  depthUsd = null,
  onNavigate,
  onUi,
  onCollapse,
}: {
  price: number | undefined;
  /** The open market, so the chip names what a prompt would actually trade. */
  market?: string;
  /**
   * The market's id, e.g. "SOLUSDT".
   *
   * Separate from `market` because that one is a LABEL — "SOL" is what the
   * chip says — and a rule armed against a label would be watching a market
   * the engine has never heard of.
   */
  symbol: string;
  /** The interval on screen, so "zoom out" has a reference point. */
  interval: Interval;
  /** Every market's live numbers, so a screening question can be answered. */
  majors: Major[];
  /** Book depth, so a sentence's fill is priced the same way the ticket's is. */
  depthUsd?: number | null;
  /**
   * Change what the terminal is looking at.
   *
   * Sana cannot do this itself — the market, the interval and the panel are
   * the terminal's state, and a component cannot set its parent's. Passing
   * the callbacks down is what makes "show me BTC on the daily" a sentence
   * that works rather than a sentence that gets a polite refusal.
   */
  onNavigate?: (to: { symbol?: string; interval?: Interval; panel?: string }) => void;
  onUi?: (action: string) => void;
  /**
   * Fold the bar away.
   *
   * Owned by the terminal, not by Sana, because collapsing changes the LAYOUT
   * AROUND the bar — the chart panel grows into the space it leaves — and a
   * component cannot resize its own sibling.
   */
  onCollapse?: () => void;
}) {
  const { account, trade } = usePaperAccount();
  const { armExits, armEntry, armed, cancelRule, server } = useTriggers();
  /* The prop is named `price`; aliased so the answer helpers read plainly. */
  const livePrice = price;
  /*
   * What the market is quoted IN.
   *
   * Binance pairs quote in USDT. On Solana everything routes through SOL —
   * except SOL, which cannot be quoted in itself: the label read "SOL/SOL".
   */
  const quote =
    symbol.endsWith("USDT") ? "USDT" : market.toUpperCase() === "SOL" ? "USDC" : "SOL";

  /*
   * THE OPEN MARKET'S MINT, and the position in it.
   *
   * Every read below used `account.sol` — the account's only asset — which was
   * correct exactly as long as there was only one. Sana now talks about the
   * market on screen: "you have no BONK to set an exit on" is about BONK, and
   * "sell half" is half of BONK.
   *
   * Null for a Binance major, which has a chart and no market behind it.
   */
  const mint = mintFor(symbol);
  const held = mint ? positionOf(account, mint) : { qty: 0, costBasis: 0 };
  /* The in-flight model request, so a new sentence can abandon the old one. */
  const pending = useRef<AbortController | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [slashOpen, setSlashOpen] = useState(false);
  const streamRef = useRef<HTMLDivElement>(null);
  /** The whole bar, so an outside click can be told from an inside one. */
  const shellRef = useRef<HTMLDivElement>(null);
  /** Whether the conversation is showing. The input bar stays. */
  const [open, setOpen] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  /**
   * Dictation submits itself.
   *
   * User's call, 13 Sep 2026: "they just speak the prompt, and the shit
   * happens". It used to drop the transcript into the box and wait for Enter,
   * which was the right shape when an approval card came next and is the wrong
   * one now that a clear sentence executes.
   *
   * THE RISK IS REAL AND WORTH NAMING. Speech recognition does not fail by
   * producing nonsense — it fails by producing a confident, well-formed
   * sentence that says something else. "Buy five hundred" and "buy five
   * thousand" are one vowel apart and both parse. What stands between that and
   * a wrong trade is validate.ts and nothing else, so the transcript is shown
   * as the user's own turn before the result, and the receipt names the size
   * that actually traded.
   */
  const speech = useSpeech((heard) => {
    const said = heard.trim();
    if (!said) return;
    setInput("");
    handle(said);
  });

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
    // Anything the user says reopens the stream — otherwise the reply lands
    // in a collapsed panel and looks like nothing happened.
    setOpen(true);

    /*
     * A new instruction supersedes an unanswered old one.
     *
     * Otherwise "Yep, do it" stays live on a card from ten minutes and four
     * sentences ago. Approving it would execute against the CURRENT price an
     * intent the user formed at a different one — the readback they approved
     * describes a trade that no longer exists.
     *
     * Superseded rather than deleted: the card stays visible with its outcome
     * written on it, which is how every other resolution here works.
     */
    setTurns((prev) =>
      prev.map((t) =>
        (t.spec || t.choices) && !t.resolved
          ? { ...t, resolved: "Superseded — you asked for something else." }
          : t,
      ),
    );

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
     * EVERYTHING ELSE GOES TO THE ROUTER, and the router always answers.
     *
     * Sana used to call the order grammar directly, which meant the prompt bar
     * could do exactly one thing — place trades — and every other sentence a
     * person might reasonably type came back as "I didn't understand". The
     * router returns a closed Intent instead, so a question, a screen, a
     * navigation and a refusal are all first-class here rather than failures
     * of the order parser.
     *
     * The switch has no default branch on purpose. Adding a capability to the
     * union stops this file compiling until it is handled, which is the point
     * of the union existing at all.
     */
    const ctx: CompileContext = { symbol, interval, hasPosition: held.qty > 0 };
    const compiled = compile(text.replace(/^\/(buy|sell)\s*/i, "$1 "), ctx);

    /*
     * THE GRAMMAR GIVES UP, THE MODEL TRIES. In that order, always.
     *
     * Only `notUnderstood` falls through. A refusal for being out of scope is
     * a DECISION, not a failure — sending "should I buy SOL?" to a model after
     * the grammar correctly declined it would be paying to have the boundary
     * re-litigated by something less certain about it. Same for clarify: the
     * ambiguity is real and a model cannot resolve it either.
     *
     * This ordering is also the entire cost control. The grammar answers in
     * ten milliseconds for free; this answers in a second or two for a
     * fraction of a cent. Reverse them and every sentence is a paid request.
     */
    if (compiled.intent.kind === "refusal" && compiled.intent.reason === "notUnderstood") {
      void askModel(text, ctx);
      return;
    }

    dispatch(compiled);
  }

  /**
   * The slow path, with something on screen while it runs.
   *
   * A pending turn goes up immediately and is replaced by the answer. Without
   * it the bar looks like it swallowed the sentence for two seconds, and the
   * reflex is to press enter again — which, for a product where enter can
   * eventually mean a trade, is a habit not to teach.
   */
  async function askModel(text: string, ctx: CompileContext) {
    /* A new sentence abandons the old request. Two answers arriving out of
       order would resolve the wrong turn. */
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;

    const id = nextId++;
    setTurns((prev) => [...prev, { id, mine: false, text: "Working that one out…", thinking: true }]);

    const compiled = await compileWithModel(text, ctx, controller.signal);
    if (controller.signal.aborted) return;

    setTurns((prev) => prev.filter((t) => t.id !== id));
    dispatch(compiled);
  }

  function dispatch(compiled: Compiled) {
    const intent = compiled.intent;

    switch (intent.kind) {
      case "refusal":
        push({ mine: false, text: intent.message });
        return;

      case "clarify":
        push({ mine: false, text: intent.question, choices: intent.options });
        return;

      case "query":
        push({ mine: false, text: answerQuery(intent.subject) });
        return;

      case "screen":
        push({
          mine: false,
          text: answerScreen(intent.metric, intent.direction, intent.limit),
          warnings: compiled.warnings.length ? compiled.warnings : undefined,
        });
        return;

      case "rules":
        push({ mine: false, text: answerRules(intent.action) });
        return;

      case "navigate": {
        if (!onNavigate) {
          push({ mine: false, text: "I can't move the terminal from here." });
          return;
        }
        onNavigate({ symbol: intent.symbol, interval: intent.interval, panel: intent.panel });
        const parts = [
          intent.symbol ? marketOf(intent.symbol).base : null,
          intent.interval ? `${intent.interval} candles` : null,
          intent.panel ? `the ${intent.panel} panel` : null,
        ].filter(Boolean);
        push({ mine: false, text: `Showing ${parts.join(", ")}.` });
        return;
      }

      case "ui":
        if (!onUi) {
          push({ mine: false, text: "I can't change the layout from here." });
          return;
        }
        onUi(intent.action);
        push({ mine: false, text: "Done." });
        return;

      case "order":
        break; // handled below — it is the only one that can move money
    }

    const spec = (intent as Extract<Intent, { kind: "order" }>).spec;

    /*
     * THE TOKEN IN THE SENTENCE MUST BE THE MARKET ON SCREEN.
     *
     * This was a live bug and a bad one: nothing checked, so "buy $500 of
     * BONK" while SOL was open bought SOL. Execution used the loaded price
     * and never looked at what the user had actually named.
     *
     * Three outcomes, and they are deliberately different sentences — "I do
     * not know that token" and "I know it and cannot trade it here" are
     * different problems with different fixes.
     */
    if (spec.entry) {
      const named = resolveMarket(spec.entry.token);
      if (!named) {
        push({
          mine: false,
          text: `I don't know "${spec.entry.token}". Pick it from the list on the left and I'll trade whatever is open.`,
        });
        return;
      }
      if (named.base.toUpperCase() !== market.toUpperCase()) {
        push({
          mine: false,
          text: `You asked for ${named.base} and ${market} is open. Switch markets first — I won't trade one thing while you're looking at another.`,
        });
        return;
      }

      /*
       * Resolved, so record it. Otherwise the validator keeps warning "I have
       * not resolved solana to a specific token" on a card where we have just
       * proved that we have.
       *
       * The field is named `mint` for the Solana leg. On a centralised pair
       * there is no mint, and the venue's own symbol IS the identity — it is
       * what the exchange guarantees and what the URL is keyed on. When the
       * Solana leg lands this becomes a real mint address from a verified
       * list, and the symbol goes back to being a display string.
       */
      spec.entry.mint = named.symbol;
    }

    /*
     * VALIDATE, THEN DO IT. No approval step.
     *
     * User's call, 13 Sep 2026, twice and explicitly: a clear instruction
     * executes. Type it and it happens. This overrides the "no rule arms
     * without an approved readback" non-negotiable, and the override is
     * recorded in CLAUDE.md rather than left as something only this file knows.
     *
     * What replaces the approval is a sharper boundary:
     *
     *   an ERROR   means the instruction is wrong. Refuse, say why, do nothing.
     *   a WARNING  means it is unusual, not wrong. Do it, and say so afterwards.
     *   AMBIGUITY  never reaches here — clarify caught it upstream.
     *
     * So the readback is not gone; it stopped being a question and became a
     * receipt. The user still sees exactly what happened in their own terms,
     * which is what the readback was always for — the click was only ever the
     * cheapest way to be sure they had seen it.
     */
    const problems = validateOrder(spec, {
      cashUsd: account.usdc,
      position: held.qty,
      price: price ?? null,
    });

    if (blocks(problems)) {
      push({
        mine: false,
        text: problems
          .filter((p) => p.severity === "error")
          .map((p) => p.message)
          .join(" "),
      });
      return;
    }

    const warnings = problems.map((p) => p.message);
    /*
     * The order goes out, and the receipt follows it.
     *
     * run() is async now that the ledger can be a network away. Nothing is
     * pushed until it resolves: a receipt rendered before the fill lands would
     * be describing a trade that might still be refused.
     */
    void run(spec).then((outcome) => {
      push({ mine: false, text: outcome, lines: readback(spec), warnings });
    });
  }

  /**
   * Carry out an order that has already been validated.
   *
   * Returns the sentence that goes above the receipt. Three shapes, and they
   * are genuinely different operations rather than one with flags:
   *
   *   a resting entry   nothing trades. The engine watches for the price.
   *   an entry now      fills, then binds its exits to what it actually paid.
   *   exits only        binds to the position already held.
   */
  async function run(spec: OrderSpec): Promise<string> {
    const entry = spec.entry;

    /* ── exits against a position already held ── */
    if (!entry) {
      if (spec.exits.length === 0) return "Nothing to do.";
      if (held.qty <= 0) return `You have no ${market} to set an exit on.`;
      /*
       * AWAITED, not fired and forgotten.
       *
       * This used to announce "2 exits are armed" the instant the request left
       * the browser. True while the engine was in this tab; a guess once it
       * moved to a server. Telling someone their stop is set when the write
       * failed is the worst sentence this product can say.
       */
      const ok = await armExits({
        rules: spec.exits,
        market: symbol,
        entryPrice: held.costBasis,
      });
      if (!ok) return "I couldn't save that exit. Nothing is watching — try again.";
      return armedLine(spec.exits.length, held.costBasis);
    }

    /* ── a resting limit order ── */
    if (entry.trigger) {
      if (!price) return "No live price, so I can't tell which way that limit is from here.";
      /*
       * The ENTRY becomes the rule, and its exits wait for it.
       *
       * The exits are armed unbound in the same breath: "buy at $95, sell half
       * at 2x" means 2x of ninety-five, and that is not knowable until the buy
       * fills. The runner binds them the moment it does.
       */
      const entryId = newId("e");
      const armed = await armEntry({
        rule: { id: entryId, trigger: entry.trigger, amount: entry.amount },
        market: symbol,
        referencePrice: price,
        side: entry.side,
      });
      if (!armed) return "I couldn't save that order. Nothing is resting — try again.";
      /* parentId, so THIS entry's fill binds these exits and no other's. */
      if (spec.exits.length > 0) {
        await armExits({ rules: spec.exits, market: symbol, parentId: entryId });
      }
      const at = usd((entry.trigger as { value: number }).value);
      return (
        `Resting. I'll ${entry.side} when ${market} reaches ${at}` +
        (spec.exits.length ? `, then arm the ${spec.exits.length === 1 ? "exit" : "exits"}.` : ".") +
        " Nothing has traded yet."
      );
    }

    /* ── fill now ── */
    if (!price) return "No live price to fill against. Nothing happened.";

    if (!mint) return `${market} is chart-only — there is no Solana market behind it.`;

    const qty = resolveQty(entry.amount, entry.side, account, mint, price);
    if (qty === null) {
      return `I can't turn "${entry.amount.kind}" into a ${entry.side} size. Nothing happened.`;
    }

    /*
     * The sentence's OWN slippage, not a default. grammar.ts has always parsed
     * "max 3% slippage" into the spec, and an earlier version of this call
     * threw it away — the one differentiator the product is built on,
     * understood correctly and then discarded on the way to the fill.
     */
    const r = await trade({
      mint,
      symbol: market,
      side: entry.side,
      qty,
      mark: price,
      source: "sana",
      depthUsd,
      slippageBps: entry.slippageBps,
    });
    if ("refusal" in r) return r.refusal;

    /*
     * Bound to the ALL-IN price, not the mark.
     *
     * allInPrice folds the spread and the commission into a single per-unit
     * number, which is what the user actually paid. Binding to the mark would
     * put every stop slightly too high and every take-profit slightly too low
     * — small, systematic, and in the direction that costs them money.
     */
    const filledAt = allInPrice(r.fill);
    const filled = `${entry.side === "buy" ? "Bought" : "Sold"} ${r.fill.qty.toFixed(4)} ${market} at ${usd(filledAt)}.`;

    if (spec.exits.length === 0) return filled;

    /*
     * The FILL already happened, so it is reported either way.
     *
     * If arming then fails, the user is in a position with no protection, and
     * that is precisely the moment to say so loudly rather than to report a
     * clean success.
     */
    const armedOk = await armExits({ rules: spec.exits, market: symbol, entryPrice: filledAt });
    return armedOk
      ? `${filled} ${armedLine(spec.exits.length, filledAt)}`
      : `${filled} But I could NOT arm the ${spec.exits.length === 1 ? "exit" : "exits"} — you are holding this unprotected. Try setting them again.`;
  }

  /*
   * Clicking away collapses the conversation.
   *
   * The stream grows all session and then sits over the chart, and the chart
   * is what the user came for. Collapsing is not the same as clearing —
   * everything is still there, and typing brings it straight back.
   */
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (shellRef.current?.contains(e.target as Node)) return;
      /*
       * EXCEPT when the LAST thing said is an unanswered question.
       *
       * Orders no longer wait for anything — they execute — so the only live
       * decision left is a clarify. Hiding one on a stray click is ambiguous
       * in the worst way: the user cannot tell whether it was cancelled or is
       * still sitting there.
       *
       * The LAST one, not any one. Checking the whole history meant a single
       * unanswered question ten messages ago blocked collapsing for the rest
       * of the session.
       */
      const last = turns[turns.length - 1];
      if (last?.choices && !last.resolved) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, turns]);

  function resolve(id: number, answer: string) {
    setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, resolved: answer } : t)));
  }

  /*
   * ANSWERS, not lookups.
   *
   * Every one of these reads state the client ALREADY holds — the account, the
   * poll that feeds the left panel, the engine's own rules. None of them may
   * trigger a fetch, which is the rule that makes a question free: a user can
   * ask a hundred and it costs nothing. If a question needs data cipher does
   * not have, it is a refusal, not a query.
   */
  function answerQuery(subject: string): string {
    const price = livePrice;
    switch (subject) {
      case "cash":
        return `${usd(account.usdc)} in cash.`;
      case "position": {
        /*
         * ABOUT THE OPEN MARKET, and then about everything else.
         *
         * "What's my position" used to have one answer because there was one
         * position. Now it leads with the market on screen and then says what
         * else is held, because omitting the rest would be a true sentence
         * that leaves a false impression.
         */
        const others = heldMints(account).filter((m) => m !== mint);
        const rest =
          others.length === 0
            ? ""
            : ` You also hold ${others.length} other ${others.length === 1 ? "coin" : "coins"}.`;
        if (held.qty <= 0) return `You're flat on ${market}.${rest}`;
        return (
          `${held.qty.toFixed(4)} ${market}, average cost ${usd(held.costBasis)}` +
          (price ? `, worth ${usd(held.qty * price)} now.` : ".") +
          rest
        );
      }
      case "equity": {
        const marks: Record<string, number> = mint && price ? { [mint]: price } : {};
        const unpriced = heldMints(account).filter((m) => marks[m] === undefined);
        /* Says what it could NOT mark rather than quietly leaving it out. A
           total that silently omits half the holdings is a wrong total. */
        const caveat =
          unpriced.length === 0
            ? ""
            : ` ${unpriced.length} holding${unpriced.length === 1 ? "" : "s"} not marked — no live price here.`;
        return `${usd(equity(account, marks))} all in, of which ${usd(account.usdc)} is cash.${caveat}`;
      }
      case "pnl": {
        const open = price && mint ? unrealised(account, mint, price) : null;
        const booked = account.realisedUsd;
        const parts = [
          `Booked ${booked >= 0 ? "+" : ""}${usd(booked)}`,
          open === null ? null : `open ${open >= 0 ? "+" : ""}${usd(open)}`,
        ].filter(Boolean);
        return `${parts.join(", ")}. Fees paid: ${usd(account.feesUsd)}.`;
      }
      case "fills": {
        if (account.fills.length === 0) return "No trades yet.";
        const recent = account.fills.slice(-3).reverse();
        return (
          `${account.fills.length} trade${account.fills.length === 1 ? "" : "s"}. Most recent: ` +
          recent
            .map((f) => `${f.side} ${f.qty.toFixed(4)} at ${usd(allInPrice(f))}`)
            .join("; ") +
          "."
        );
      }
      case "fees":
        return `${usd(account.feesUsd)} in fees so far, on ${account.fills.length} trade${account.fills.length === 1 ? "" : "s"}.`;
      case "market": {
        const m = majors.find((x) => x.id === symbol);
        if (!m) return "I don't have this market's numbers yet.";
        return (
          `${market}: ${usd(m.priceUsd)}, ${pct(m.change24h)} over 24h` +
          (m.marketCap === null ? "." : `, ${compactUsd(m.marketCap)} cap.`)
        );
      }
      default:
        return "I don't have that.";
    }
  }

  /**
   * Rank the market list.
   *
   * Reads the same poll that fills the left panel, so the answer and the rows
   * can never disagree — which is the whole reason this is not a separate
   * fetch with its own idea of the price.
   */
  function answerScreen(
    metric: "return" | "volume" | "marketCap" | "price",
    direction: "top" | "bottom",
    limit: number,
  ): string {
    if (majors.length === 0) return "The market list hasn't loaded yet. Ask me again in a second.";

    /*
     * A missing market cap sorts last, never as zero.
     *
     * marketCap is nullable — the supply table does not cover every pair — and
     * treating null as 0 would put an unknown cap at the BOTTOM of "biggest"
     * and the TOP of "smallest", which is a confident wrong answer in one
     * direction and a confident wrong answer in the other.
     */
    const value = (m: Major) =>
      metric === "return" ? m.change24h
      : metric === "volume" ? m.volume24hUsd
      : metric === "marketCap" ? (m.marketCap ?? Number.NEGATIVE_INFINITY)
      : m.priceUsd;

    const sorted = [...majors].sort((a, b) =>
      direction === "top" ? value(b) - value(a) : value(a) - value(b),
    );

    const label = (m: Major) => {
      const base = marketOf(m.id).base;
      switch (metric) {
        case "return":
          return `${base} ${pct(m.change24h)}`;
        case "volume":
          return `${base} ${compactUsd(m.volume24hUsd)}`;
        case "marketCap":
          return `${base} ${m.marketCap === null ? "cap unknown" : compactUsd(m.marketCap)}`;
        case "price":
          return `${base} ${usd(m.priceUsd)}`;
      }
    };

    const head =
      metric === "return"
        ? direction === "top" ? "Up the most over 24h" : "Down the most over 24h"
        : metric === "volume" ? "Most traded over 24h"
        : metric === "marketCap" ? "Biggest by market cap"
        : direction === "top" ? "Highest price" : "Lowest price";

    return `${head}: ${sorted.slice(0, limit).map(label).join(", ")}.`;
  }

  /**
   * What the engine is watching, and how to stop it.
   *
   * cancelAll is deliberately blunt and deliberately immediate. The person
   * asking for it is not browsing — something is going wrong and they want out
   * of every rule at once. A confirmation step here would be the wrong kind of
   * caution: cancelling a rule can only ever prevent a trade, never cause one.
   */
  function answerRules(action: "list" | "cancelAll"): string {
    if (action === "cancelAll") {
      if (armed.length === 0) return "Nothing was armed.";
      const n = armed.length;
      for (const r of armed) cancelRule(r.id);
      return `Cancelled ${n} rule${n === 1 ? "" : "s"}. Nothing is watching the price now.`;
    }
    if (armed.length === 0) return "Nothing armed. Nothing is watching the price.";
    return (
      `${armed.length} armed: ` +
      armed
        .map((r) => {
          const base = baseSymbol(r.market);
          const t = r.trigger;
          const when =
            t.kind === "priceMultiple" ? `at ${t.value}x`
            : t.kind === "priceAbsolute" ? `at ${usd(t.value)}`
            : t.kind === "drawdownFromEntry" ? `if ${base} falls ${t.percent}% from entry`
            : t.kind === "trailingStop" ? `${t.percent}% below the high`
            : "on a timer";
          return `sell ${r.amount.kind === "percentOfPosition" ? `${r.amount.value}%` : r.amount.value} ${when}`;
        })
        .join("; ") +
      `. ${watchedBy()}`
    );
  }

  /**
   * WHO IS ACTUALLY WATCHING — and it is not always this tab.
   *
   * This said "they fire while this tab is open" unconditionally, which was
   * true for as long as the rules lived in a React ref and stopped being true
   * the moment the worker started firing them from Postgres. Signed in, a stop
   * survives the laptop being shut; signed out, it does not. Both are honest,
   * and saying the wrong one is worse than saying neither: a user who closes
   * the tab believing the stop is dead behaves differently from one who knows
   * it is live, and so does a user who believes the opposite.
   */
  function watchedBy(): string {
    return server
      ? "They fire on the server, whether or not this tab is open."
      : "They fire while this tab is open — sign in to have the server watch them.";
  }

  /** One sentence saying what is now watching, and the honest limit on it. */
  function armedLine(count: number, entryPrice: number): string {
    return (
      `${count === 1 ? "One exit is" : `${count} exits are`} armed against ` +
      `${usd(entryPrice)} and watching. ${watchedBy()} ` +
      `Say "cancel my stops" to take them back.`
    );
  }

  return (
    <div
      ref={shellRef}
      onMouseDown={() => {
        /*
         * Open AND focus, on the same press.
         *
         * Opening the stream changes the bar's height, so the input moves out
         * from under the pointer between mousedown and mouseup and the click
         * never completes on it. The first click on a collapsed bar therefore
         * expanded it and focused nothing, and whatever the user typed next
         * went into the void — which, for a bar whose entire purpose is that
         * you type into it, is the worst first impression available.
         *
         * Focusing explicitly makes the press mean what it looks like it
         * means, regardless of what the layout does afterwards.
         */
        setOpen(true);
        inputRef.current?.focus();
      }}
      /*
       * Spans the chart column rather than a narrow strip inside it.
       *
       * It was max-w-2xl — 672px sitting in a column half again as wide, with
       * dead space either side and the readback cards wrapping inside a box
       * narrower than they needed. Capped at max-w-5xl rather than uncapped:
       * on a very wide monitor a command bar running the full span stops
       * reading as something you talk to and starts reading as a footer.
       */
      className="mx-auto flex w-full max-w-5xl shrink-0 flex-col rounded-2xl border border-line bg-panel px-3 pb-3"
    >
      {/*
        * Collapsed, with history behind it.
        *
        * A panel that vanishes with no trace of itself reads as lost rather
        * than hidden. One line, the last thing said, and the whole thing comes
        * back on a click — so the collapse is obviously reversible without
        * having to discover that typing reopens it.
        */}
      {!open && turns.length > 0 && (
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 overflow-hidden px-1 pb-2 pt-2.5 text-left transition-opacity hover:opacity-80"
        >
          <span className="shrink-0 rounded-full bg-raised px-1.5 py-px font-mono text-[9.5px] text-ash">
            {turns.length}
          </span>
          <span className="truncate font-sans text-[11.5px] text-mute">
            {turns[turns.length - 1].text}
          </span>
        </button>
      )}

      {open && turns.length > 0 && (
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

                  {/*
                    * An ambiguity, offered as the two sentences it could be.
                    *
                    * Picking one RE-RUNS the compiler on that sentence rather
                    * than patching a half-parsed spec, so the clarified order
                    * goes through the same grammar, validator and readback as
                    * anything typed by hand. It gets a readback card of its
                    * own; nothing here approves a trade.
                    */}
                  {t.choices && !t.resolved && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {t.choices.map((c) => (
                        <button
                          key={c.sentence}
                          onClick={() => {
                            setTurns((prev) =>
                              prev.map((x) => (x.id === t.id ? { ...x, resolved: c.label } : x)),
                            );
                            handle(c.sentence);
                          }}
                          className="rounded-lg border border-line bg-slate px-3 py-1.5 font-sans text-[12px] font-bold text-champagne transition-colors hover:border-accent hover:bg-raised"
                        >
                          {c.label}
                        </button>
                      ))}
                    </div>
                  )}

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

                      {/* Warnings sit between the order and the approve
                          button, on purpose. Below the button they would be
                          read after the decision; above the readback they
                          would be read before there is anything to apply them
                          to. */}
                      {t.warnings && t.warnings.length > 0 && !t.resolved && (
                        <ul className="mt-2.5 flex flex-col gap-1 border-t border-accent/20 pt-2">
                          {t.warnings.map((w) => (
                            <li
                              key={w}
                              className="flex gap-1.5 font-sans text-[11px] leading-snug text-ash"
                            >
                              <span aria-hidden className="shrink-0 text-accent">!</span>
                              {w}
                            </li>
                          ))}
                        </ul>
                      )}

                      {/*
                        * No buttons. The card is a receipt, not a request —
                        * by the time it renders, the order has happened.
                        */}
                      {t.resolved && (
                        <p className="mt-2.5 font-sans text-[11.5px] text-champagne">
                          {t.resolved}
                        </p>
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
          className="flex items-center gap-2.5 rounded-xl bg-champagne py-2 pl-3 pr-2 shadow-lg shadow-black/30 ring-1 ring-black/10 focus-within:ring-4 focus-within:ring-accent"
        >
          {/*
            * The quote asset, not a hardcoded one.
            *
            * This said "/USDT" for every market, which was true while the
            * list was fourteen Binance pairs and became false the moment the
            * panel listed Solana. A bonding-curve token quoted against SOL
            * was labelled NTDA/USDT — a pair that does not exist, printed in
            * the most confident place on the screen.
            */}
          <span className="shrink-0 rounded-lg bg-ink/10 px-2 py-1 font-mono text-[11px] text-ink/60">
            <b className="font-bold text-ink">{market}</b>/{quote}
          </span>
          <input
            ref={inputRef}
            value={speech.listening ? speech.transcript + speech.interim : input}
            readOnly={speech.listening}
            onChange={(e) => {
              setInput(e.target.value);
              setSlashOpen(e.target.value.startsWith("/") && !e.target.value.includes(" "));
            }}
            onKeyDown={(e) => e.key === "Escape" && setSlashOpen(false)}
            placeholder={
              speech.listening ? "Listening…" : "Ask Sana, place a trade, or /copy a friend"
            }
            aria-label="Ask Sana or type a command"
            className="min-w-0 flex-1 bg-transparent font-sans text-sm text-ink placeholder:text-ink/45 focus:outline-none"
          />

          {/* Hidden entirely in Firefox and on insecure origins rather than
              offered and then failing — a mic button that cannot work is a
              worse answer than no mic button. */}
          {speech.supported && (
            <button
              type="button"
              onClick={() => (speech.listening ? speech.stop() : speech.start())}
              aria-pressed={speech.listening}
              aria-label={speech.listening ? "Stop listening" : "Speak your order"}
              className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg transition-colors ${
                speech.listening
                  ? "animate-pulse bg-down text-champagne"
                  : "text-ink/50 hover:bg-ink/10 hover:text-ink"
              }`}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <rect x="9" y="2" width="6" height="11" rx="3" />
                <path d="M5 10a7 7 0 0 0 14 0M12 17v4" />
              </svg>
            </button>
          )}

          <span className="shrink-0 font-mono text-[10.5px] text-ink/40">⏎</span>
          <button
            type="submit"
            aria-label="Send to Sana"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-ink text-champagne hover:brightness-150"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8">
              <path d="M5 12h13M12 5.5l6.5 6.5-6.5 6.5" />
            </svg>
          </button>
        </form>
      </div>

      {speech.error && (
        <p className="mt-1.5 rounded-lg border border-down/40 bg-down/10 px-2.5 py-1.5 font-sans text-[11px] text-champagne">
          {speech.error}
        </p>
      )}

      {/*
        * One word where two lines of hints used to be.
        *
        * The hints told a first-time user things a second-time user has to
        * read past forever, on the row closest to the thing they are trying to
        * look at. What belongs in that space is a way out of it.
        *
        * A word rather than a chevron: a glyph in the corner of a bar is
        * guessable at best, and this one does something people will want on
        * their first session.
        */}
      <div className="flex justify-center px-1 pt-2">
        <button
          onClick={onCollapse}
          aria-label="Close Sana"
          className="font-sans text-[10.5px] text-mute transition-colors hover:text-champagne"
        >
          Close
        </button>
      </div>
    </div>
  );
}

/**
 * Sana's mark: the bar, folded.
 *
 * Lives here because it is Sana's identity, but it is RENDERED by the terminal,
 * because where it sits is a layout decision — when the bar folds, the chart
 * panel grows into the space, and the mark floats over the boundary rather
 * than occupying a row of its own.
 *
 * The motion is three layers turning at different speeds. See .sana-ring and
 * friends in globals.css for why two counter-rotating gradients read as alive
 * where one reads as loading.
 */
export function SanaMark({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      aria-label="Open Sana"
      aria-expanded={false}
      title="Open Sana"
      className="relative h-6 w-6 rounded-full transition-transform hover:scale-110 active:scale-95"
    >
      {/* Outside the disc, so it reads as light coming off the orb rather than
          as another layer drawn on it. */}
      <span className="sana-glow pointer-events-none absolute -inset-1 rounded-full" />

      {/* overflow-hidden is what makes the blobs a sphere. They are far larger
          than the disc and drift past its edges; clipped, you only ever see
          colour moving inside a circle, never a blob with a shape. */}
      <span className="sana-orb pointer-events-none absolute inset-0 overflow-hidden rounded-full">
        {/* PAINT ORDER IS THE DESIGN. These stack in DOM order, so violet
            goes down first as the backdrop and the cyan sits on top —
            reversed, the violet blankets the other two and the whole orb reads
            as one purple circle. */}
        <span className="sana-blob-c absolute inset-[-30%]" />
        <span className="sana-blob-b absolute inset-[-30%]" />
        <span className="sana-blob-a absolute inset-[-30%]" />
        {/* Above the blobs: the shading has to survive them drifting under it,
            or the sphere flattens every time a bright blob passes the rim. */}
        <span className="sana-shade absolute inset-0 rounded-full" />
      </span>
    </button>
  );
}
