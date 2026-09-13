"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  arm,
  armed as armedRules,
  bind,
  cancel,
  emptyEngine,
  onClock,
  onPrice,
  onResult,
  threshold,
  type EngineState,
  type ExitRule,
  type Rule,
  type Transition,
} from "@cipher/shared";
import { usePaperAccount } from "../account/store";
import { allInPrice } from "../account/paper";
import { fireRule } from "./execute";

/**
 * The host. Where the engine actually runs.
 *
 * The engine is pure and has no clock, no feed and no storage — deliberately,
 * so it can move to a server worker unchanged. Everything it refuses to do is
 * done here: hold the state, tick it, persist it, and hand each fired rule to
 * the execution seam.
 *
 * cipher: THIS RUNS IN THE BROWSER, and that is the honest limit of the paper
 * version. Close the tab and nothing is watching. The fix is not a better
 * version of this file — it is this file's logic inside a worker with a shared
 * price feed and a heartbeat, and the engine and the seam move there untouched.
 * Until then the UI must say so rather than imply a promise nobody is keeping.
 */

/* Bump rather than migrate: rules read into a changed shape fire wrongly. */
const KEY = "cipher.rules.v1";

/**
 * How much history to keep.
 *
 * The transition log is append-only by design — it is the audit trail — but
 * localStorage is not a database, and an unbounded array eventually fails a
 * write and takes the armed rules with it. Trimming the OLDEST is the least
 * bad choice here; when this moves to Postgres nothing is trimmed at all.
 */
const MAX_TRANSITIONS = 500;

interface Stored {
  engine: EngineState;
  transitions: Transition[];
}

interface Ctx {
  /** Rules currently watching. */
  armed: Rule[];
  /**
   * Every rule the engine has ever held, by id — including the finished ones.
   *
   * The history list needs them. A transition says "filled"; only the rule it
   * belongs to can say WHAT filled, and "why did you sell my SOL" is the
   * question this panel exists to answer.
   */
  rulesById: Record<string, Rule>;
  /** Every state change, newest last. The audit trail. */
  transitions: Transition[];
  hydrated: boolean;
  /**
   * Start watching a set of exits.
   *
   * `entryPrice` is omitted when the exits were compiled alongside a buy that
   * has not filled — they arrive unbound and inert, and bindEntry() wakes them
   * with the fill price.
   */
  armExits(input: { rules: ExitRule[]; market: string; entryPrice?: number }): void;
  /**
   * Start watching for a price to BUY at. A resting limit order.
   *
   * Separate from armExits because the reference price means something
   * different: an exit measures from what you paid, and there is nothing paid
   * yet here, so a resting buy measures from the market price at arm time —
   * which is all "at $95" needs, a reference to know whether $95 arrives by
   * falling or by rising.
   */
  armEntry(input: { rule: ExitRule; market: string; referencePrice: number }): void;
  /** An entry filled: bind every unbound rule on that market to its fill price. */
  bindEntry(market: string, entryPrice: number): void;
  cancelRule(id: string): void;
  /** What a rule is waiting for, as a price. Null for timed exits. */
  thresholdOf(rule: Rule): number | null;
  clearAll(): void;
}

const TriggerContext = createContext<Ctx | null>(null);

function load(): Stored | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Stored;
    if (!parsed?.engine?.rules || typeof parsed.engine.rules !== "object") return null;
    return { engine: parsed.engine, transitions: parsed.transitions ?? [] };
  } catch {
    return null;
  }
}

export function TriggerProvider({
  children,
  /**
   * The price of the market the user is looking at, live from the socket.
   * Null before the first tick.
   */
  live,
  market,
  /** Prices for every market, from the poll. Coarser, but it covers the rest. */
  prices,
}: {
  children: ReactNode;
  live: number | null;
  market: string;
  prices?: Record<string, number>;
}) {
  const { account, fire } = usePaperAccount();
  const [state, setState] = useState<Stored>(() => ({
    engine: emptyEngine(),
    transitions: [],
  }));
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setState(load() ?? { engine: emptyEngine(), transitions: [] });
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* Private windows, blocked site data, a full quota. The session works. */
    }
  }, [state, hydrated]);

  /*
   * The account, read through a ref.
   *
   * A rule fires inside a tick, and the tick needs the CURRENT balance to size
   * "sell a third". Putting `account` in the tick's dependency array would
   * rebuild the whole subscription on every fill; a ref keeps the latest value
   * available without making the effect depend on it.
   */
  const accountRef = useRef(account);
  accountRef.current = account;

  /**
   * Apply one engine Step: execute what fired, record what moved.
   *
   * Every path into the engine funnels through here, so there is exactly one
   * place where a transition is recorded and exactly one place where money
   * moves — which is the property that makes the audit trail trustworthy.
   */
  const applyStep = useCallback(
    (next: EngineState, fired: Rule[], transitions: Transition[], mark: number) => {
      const log = [...transitions];

      for (const rule of fired) {
        const outcome = fire(rule, { mark });
        const at = Date.now();

        if (outcome.kind === "filled") {
          log.push(...onResult(next, rule.id, { ok: true }, at).transitions);
          /*
           * A resting BUY that just filled is an entry, and exits armed
           * alongside it have been sitting unbound waiting for exactly this
           * price. "Buy at $95, sell half at 2x" means 2x of what the buy
           * actually cost — not of $95, and not of whatever the market was
           * when the sentence was typed.
           */
          if (rule.side === "buy") {
            const paid = allInPrice(outcome.fill);
            for (const r of Object.values(next.rules)) {
              if (r.market !== rule.market || r.state !== "unbound") continue;
              log.push(...bind(next, r.id, paid, at).transitions);
            }
          }
        } else if (outcome.kind === "moot") {
          /*
           * NOT A FAILURE. The position is gone, or what is left is dust. A
           * retry would run three times and then tell the user their stop
           * failed, for a trade that was never owed.
           */
          log.push(...cancel(next, rule.id, at).transitions);
        } else {
          log.push(
            ...onResult(next, rule.id, { ok: false, reason: outcome.reason }, at).transitions,
          );
        }
      }

      setState((prev) => ({
        engine: next,
        transitions: [...prev.transitions, ...log].slice(-MAX_TRANSITIONS),
      }));
    },
    [fire],
  );

  /*
   * Price ticks.
   *
   * Two sources, and the difference is worth knowing. The open market arrives
   * from the websocket, so a stop on what you are watching fires in about a
   * second. Every other market arrives from the poll that feeds the left
   * panel, so a stop on a market you are NOT watching fires at poll
   * resolution. Both are honest; neither is a server.
   */
  useEffect(() => {
    if (!hydrated || live === null) return;
    const step = onPrice(state.engine, market, live, Date.now());
    if (step.fire.length === 0 && step.transitions.length === 0) return;
    applyStep(step.state, step.fire, step.transitions, live);
    // `state.engine` is deliberately excluded: onPrice mutates the state
    // object in place and applyStep writes it back, so depending on it here
    // would re-run this effect for its own result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, market, hydrated, applyStep]);

  useEffect(() => {
    if (!hydrated || !prices) return;
    for (const [symbol, price] of Object.entries(prices)) {
      if (symbol === market) continue; // the socket already covers this one
      const step = onPrice(state.engine, symbol, price, Date.now());
      if (step.fire.length === 0 && step.transitions.length === 0) continue;
      applyStep(step.state, step.fire, step.transitions, price);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prices, market, hydrated, applyStep]);

  /*
   * The clock.
   *
   * Separate from price because timed exits are the gap-proof ones: a market
   * that gaps straight through a stop still passes through every second on the
   * way. A rule whose only trigger is a deadline must not wait for a trade to
   * print. One second is finer than any deadline a user can express.
   */
  useEffect(() => {
    if (!hydrated) return;
    const id = window.setInterval(() => {
      const step = onClock(state.engine, Date.now());
      if (step.fire.length === 0 && step.transitions.length === 0) return;
      /*
       * A timed exit fires at the last price we have. The open market's live
       * price is right; anything else falls back to the poll. With neither,
       * there is no price to fill at and the rule waits for the next tick
       * rather than executing against a number we invented.
       */
      const mark = step.fire.every((r) => r.market === market)
        ? live
        : (prices?.[step.fire[0].market] ?? null);
      if (mark === null) return;
      applyStep(step.state, step.fire, step.transitions, mark);
    }, 1_000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, live, market, prices, applyStep]);

  const armExits = useCallback<Ctx["armExits"]>(({ rules, market: m, entryPrice }) => {
    setState((prev) => {
      const engine = prev.engine;
      const log: Transition[] = [];
      for (const rule of rules) {
        const step = arm(engine, { rule, market: m, at: Date.now(), entryPrice });
        log.push(...step.transitions);
      }
      return {
        engine: { ...engine },
        transitions: [...prev.transitions, ...log].slice(-MAX_TRANSITIONS),
      };
    });
  }, []);

  const armEntry = useCallback<Ctx["armEntry"]>(({ rule, market: m, referencePrice }) => {
    setState((prev) => {
      const engine = prev.engine;
      const step = arm(engine, {
        rule,
        market: m,
        at: Date.now(),
        side: "buy",
        entryPrice: referencePrice,
      });
      return {
        engine: { ...engine },
        transitions: [...prev.transitions, ...step.transitions].slice(-MAX_TRANSITIONS),
      };
    });
  }, []);

  const bindEntry = useCallback<Ctx["bindEntry"]>((m, entryPrice) => {
    setState((prev) => {
      const engine = prev.engine;
      const log: Transition[] = [];
      for (const rule of Object.values(engine.rules)) {
        if (rule.market !== m || rule.state !== "unbound") continue;
        log.push(...bind(engine, rule.id, entryPrice, Date.now()).transitions);
      }
      if (log.length === 0) return prev;
      return {
        engine: { ...engine },
        transitions: [...prev.transitions, ...log].slice(-MAX_TRANSITIONS),
      };
    });
  }, []);

  const cancelRule = useCallback<Ctx["cancelRule"]>((id) => {
    setState((prev) => {
      const engine = prev.engine;
      const step = cancel(engine, id, Date.now());
      if (step.transitions.length === 0) return prev;
      return {
        engine: { ...engine },
        transitions: [...prev.transitions, ...step.transitions].slice(-MAX_TRANSITIONS),
      };
    });
  }, []);

  const clearAll = useCallback(() => {
    setState({ engine: emptyEngine(), transitions: [] });
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      armed: armedRules(state.engine),
      rulesById: state.engine.rules,
      transitions: state.transitions,
      hydrated,
      armExits,
      armEntry,
      bindEntry,
      cancelRule,
      thresholdOf: threshold,
      clearAll,
    }),
    [state, hydrated, armExits, armEntry, bindEntry, cancelRule, clearAll],
  );

  return <TriggerContext.Provider value={value}>{children}</TriggerContext.Provider>;
}

export function useTriggers(): Ctx {
  const ctx = useContext(TriggerContext);
  if (!ctx) throw new Error("useTriggers must be used inside <TriggerProvider>");
  return ctx;
}

export { fireRule };
