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
import { mintFor } from "../chain/markets";
import {
  arm,
  armed as armedRules,
  bind,
  cancel,
  emptyEngine,
  onClock,
  onFlat,
  onPrice,
  onResult,
  threshold,
  type EngineState,
  type ExitRule,
  type Rule,
  type Transition,
} from "@cipher/shared";
import { usePrivy } from "@privy-io/react-auth";
import { usePaperAccount } from "../account/store";
import { positionOf } from "../account/paper";
import { allInPrice } from "../account/paper";
import { armRemote, cancelRemote, fetchSnapshotResult } from "../db/remote";
import { fireRule } from "./execute";

/**
 * The host. Where the engine actually runs.
 *
 * The engine is pure and has no clock, no feed and no storage — deliberately,
 * so it can move to a server worker unchanged. Everything it refuses to do is
 * done here: hold the state, tick it, persist it, and hand each fired rule to
 * the execution seam.
 *
 * TWO MODES, and which one is running is decided here and nowhere else.
 *
 *   SERVER   signed in, with a database configured. Rules live in Postgres and
 *            are fired by /api/tick on a schedule. This file stops ticking the
 *            engine entirely and becomes a view: it arms, it cancels, it polls.
 *            Closing the tab changes nothing, which is the whole point.
 *
 *   LOCAL    signed out, or no database. Rules live in this browser and are
 *            watched by this tab, exactly as before. /trade is public and the
 *            paper account works without an account, so this is a real mode
 *            rather than a degraded one — but a rule armed here dies with the
 *            tab, and the UI says so.
 *
 * THE BROWSER MUST NOT TICK IN SERVER MODE. Two engines against one ledger is
 * two writers: the worker fires a stop, the tab fires the same stop against a
 * balance it has not refetched, and one of them wins by arriving second. The
 * database's conditional UPDATE makes the SERVER side exactly-once; the only
 * way to extend that guarantee to the tab is for the tab not to trade.
 */

/*
 * Bump rather than migrate: rules read into a changed shape fire wrongly.
 *
 * v2 because Rule gained `side` and `parentId`. A v1 rule read into this shape
 * has an undefined side, and the seam would ask the ledger to execute neither
 * a buy nor a sell — the kind of thing that throws in one place and silently
 * does the wrong thing in another. Dropping them is safe: they are paper
 * orders, and an order that quietly stops existing is better than one that
 * fires in a direction nobody chose.
 */
const KEY = "cipher.rules.v2";

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
  /** True when the server owns the rules and fires them without this tab. */
  server: boolean;
  /**
   * False when the worker's heartbeat has gone stale.
   *
   * A deadman's switch, not a promise. Every armed rule implies "this is being
   * watched", and when that stops being true it stops silently — which is the
   * one thing a user cannot act on. Meaningless in local mode, where the tab
   * itself is the watcher.
   */
  watching: boolean;
  /** Rules currently watching. */
  armed: Rule[];
  /**
   * Exits armed alongside a resting order that has not filled yet.
   *
   * They exist, they are inert, and the panel showed NOTHING for them — so
   * "buy at $95, sell half at 2x" listed the buy and silently dropped the
   * take-profit. The user retypes it, and now two take-profits bind when the
   * entry fills and the whole position sells at 2x instead of half.
   */
  waiting: Rule[];
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
  /**
   * Returns false when the server refused.
   *
   * It used to return void and fire-and-forget, so Sana announced "2 exits are
   * armed" the instant the request left the browser — true in local mode, and
   * a guess in server mode. Telling someone their stop is set when the write
   * failed is the worst sentence this product can say.
   */
  armExits(input: {
    rules: ExitRule[];
    market: string;
    entryPrice?: number;
    /** The resting entry these wait for. Omitted when the entry already filled. */
    parentId?: string;
  }): Promise<boolean>;
  /**
   * Start watching for a price to BUY at. A resting limit order.
   *
   * Separate from armExits because the reference price means something
   * different: an exit measures from what you paid, and there is nothing paid
   * yet here, so a resting buy measures from the market price at arm time —
   * which is all "at $95" needs, a reference to know whether $95 arrives by
   * falling or by rising.
   */
  armEntry(input: {
    rule: ExitRule;
    market: string;
    referencePrice: number;
    /**
     * Which way it trades when it fires. NO DEFAULT, on purpose.
     *
     * This was hardcoded to "buy", so "sell 2 SOL at $120" armed a BUY at $120
     * and the ticket's Limit tab did the same with Sell selected. A resting
     * order that trades the opposite direction from the one asked for is the
     * worst bug this file could carry, and a default is exactly how it got
     * there — the caller always knows the side, so it has to say it.
     */
    side: "buy" | "sell";
  }): Promise<boolean>;
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

/**
 * EVERY MARKET KEY ENTERING THE ENGINE BECOMES A MINT, here and nowhere else.
 *
 * The callers speak Binance pairs, because that is what the chart, the
 * navigator and the ticket are built on. The worker speaks mints, because that
 * is what Solana and Jupiter speak. For a while the two never met: a rule
 * armed in the browser went into Postgres with `market = "SOLUSDT"`, the
 * worker asked Jupiter the price of a token by that name, got nothing back and
 * skipped the market — so every rule armed through the UI was unfireable by
 * the one thing built to fire it. The only reason it was not silent is that
 * the worker reports what it skipped.
 *
 * Translating at the provider boundary was not enough: Sana and the ticket
 * pass their own symbol straight into these calls and never read the prop. The
 * arming functions ARE the edge, so the conversion belongs in them.
 *
 * A market with no Solana listing keeps its key unchanged. That is deliberate
 * — inventing a mint for BTC would be a promise nothing can keep — and such a
 * rule is one the worker will skip and say so.
 */
function key(market: string): string {
  return mintFor(market) ?? market;
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
  const { authenticated, getAccessToken } = usePrivy();
  const [state, setState] = useState<Stored>(() => ({
    engine: emptyEngine(),
    transitions: [],
  }));
  const [hydrated, setHydrated] = useState(false);
  const [server, setServer] = useState(false);
  const [watching, setWatching] = useState(false);

  /*
   * The access token, held rather than fetched per call.
   *
   * getAccessToken() refreshes the token when it is close to expiring, so it
   * is the right thing to call — but calling it inside a poll that runs every
   * few seconds turns a cheap loop into a chatty one.
   */
  const token = useRef<string | null>(null);
  useEffect(() => {
    if (!authenticated) {
      token.current = null;
      setServer(false);
      return;
    }
    let alive = true;
    void getAccessToken().then((t) => {
      if (alive) token.current = t;
    });
    return () => {
      alive = false;
    };
  }, [authenticated, getAccessToken]);

  /*
   * Ask the server what it knows, and keep asking.
   *
   * The poll is how a fill that happened while the tab was closed — or on
   * another device, or ten seconds ago in the worker — reaches this screen.
   * Five seconds: fast enough that a rule firing feels immediate, slow enough
   * that an idle tab is not a load generator.
   *
   * A failure means local mode, not an error. No database configured and no
   * session are the same answer from here: the server is not the owner.
   */
  /*
   * Set once the server has said it has no database. Stops the poll.
   *
   * A ref rather than state: it must not cause a render, and the interval
   * below reads it on every tick without needing to be rebuilt.
   */
  const unconfigured = useRef(false);

  const pull = useCallback(async () => {
    const r = await fetchSnapshotResult(token.current);
    if (r.kind === "unconfigured") {
      unconfigured.current = true;
      setServer(false);
      return;
    }
    if (r.kind !== "ok") {
      // Transient. Stay in whatever mode we were in and try again.
      return;
    }
    setServer(true);
    setWatching(r.snapshot.watching);
    const engine = emptyEngine();
    for (const rule of r.snapshot.rules) engine.rules[rule.id] = rule;
    setState({ engine, transitions: r.snapshot.transitions });
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    let alive = true;
    const run = () => {
      if (alive && !unconfigured.current) void pull();
    };
    const first = window.setTimeout(run, 300);
    const id = window.setInterval(run, 5_000);
    return () => {
      alive = false;
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [authenticated, pull]);

  useEffect(() => {
    setState(load() ?? { engine: emptyEngine(), transitions: [] });
    setHydrated(true);
  }, []);

  useEffect(() => {
    /* In server mode the rows ARE the state; writing a copy to localStorage
       would leave a stale shadow to be read back on the next cold start. */
    if (server || !hydrated) return;
    try {
      window.localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* Private windows, blocked site data, a full quota. The session works. */
    }
  }, [state, hydrated, server]);

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
              /*
               * ONLY THIS ENTRY'S OWN EXITS.
               *
               * Matching on market alone let the first resting buy to fill
               * bind every waiting exit on that market, including ones armed
               * alongside a different order that had not traded. The alerts
               * panel showed a 2x target priced off the wrong fill.
               */
              if (r.parentId !== rule.id || r.state !== "unbound") continue;
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
   * THE POSITION EMPTIED, so every exit on it is now meaningless.
   *
   * onFlat has existed since the engine was written and NOTHING CALLED IT —
   * found by audit, not by a test. The consequence is not cosmetic: sell out
   * by hand at $105 with a stop armed at $71, buy back two weeks later at $60,
   * and that stale stop sells the new position on the next tick because $60 is
   * already below a threshold measured from an entry you left behind.
   *
   * Watching the balance rather than hooking every sell path: the ticket, the
   * prompt bar and a fired rule can all take a position to zero, and three
   * call sites is three chances to add a fourth and forget.
   */
  const wasHolding = useRef(false);
  useEffect(() => {
    if (server || !hydrated) return;
    /* THIS market's position, not the account's only one. Watching the whole
       account would cancel BONK's exits because SOL went flat. */
    const holding = positionOf(account, market).qty > 0;
    const emptied = wasHolding.current && !holding;
    wasHolding.current = holding;
    if (!emptied) return;

    setState((prev) => {
      const engine = prev.engine;
      const step = onFlat(engine, market, Date.now());
      if (step.transitions.length === 0) return prev;
      return {
        engine: { ...engine },
        transitions: [...prev.transitions, ...step.transitions].slice(-MAX_TRANSITIONS),
      };
    });
  }, [account, market, server, hydrated]);

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
    /*
     * `server &&` is the guard that keeps one ledger.
     *
     * In server mode the worker fires everything; a tab that also fired would
     * be a second writer racing the first, and the loser's trade silently
     * disappears. See the note at the top of this file.
     */
    if (server || !hydrated || live === null) return;
    const step = onPrice(state.engine, market, live, Date.now());
    if (step.fire.length === 0 && step.transitions.length === 0) return;
    applyStep(step.state, step.fire, step.transitions, live);
    // `state.engine` is deliberately excluded: onPrice mutates the state
    // object in place and applyStep writes it back, so depending on it here
    // would re-run this effect for its own result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server, live, market, hydrated, applyStep]);

  useEffect(() => {
    if (server || !hydrated || !prices) return;
    for (const [symbol, price] of Object.entries(prices)) {
      if (symbol === market) continue; // the socket already covers this one
      const step = onPrice(state.engine, symbol, price, Date.now());
      if (step.fire.length === 0 && step.transitions.length === 0) continue;
      applyStep(step.state, step.fire, step.transitions, price);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server, prices, market, hydrated, applyStep]);

  /*
   * The clock.
   *
   * Separate from price because timed exits are the gap-proof ones: a market
   * that gaps straight through a stop still passes through every second on the
   * way. A rule whose only trigger is a deadline must not wait for a trade to
   * print. One second is finer than any deadline a user can express.
   */
  useEffect(() => {
    if (server || !hydrated) return;
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
  }, [server, hydrated, live, market, prices, applyStep]);

  const armExits = useCallback<Ctx["armExits"]>(async ({ rules, market: raw, entryPrice, parentId }) => {
    const m = key(raw);
    /*
     * SERVER MODE ARMS THROUGH THE API and does not touch local state.
     *
     * The poll brings the rule back a moment later, which is slightly slower
     * than writing it locally and then reconciling — and much harder to get
     * wrong. A local copy that the server rejects, or renames, or expires
     * differently is a rule the user can see and the worker cannot fire.
     */
    if (server) {
      const now = Date.now();
      const built: Rule[] = rules.map((r) => ({
        version: 1,
        id: r.id,
        market: m,
        side: "sell",
        parentId: parentId ?? null,
        trigger: r.trigger,
        amount: r.amount,
        state: entryPrice === undefined ? "unbound" : "armed",
        armedAt: now,
        expiresAt: now, // the server overwrites this — it owns the blast radius
        entryPrice: entryPrice ?? null,
        highWater: r.trigger.kind === "trailingStop" ? (entryPrice ?? null) : null,
        attempts: 0,
      }));
      const ok = await armRemote(token.current, built);
      if (ok) void pull();
      return ok;
    }

    setState((prev) => {
      const engine = prev.engine;
      const log: Transition[] = [];
      for (const rule of rules) {
        const step = arm(engine, { rule, market: m, at: Date.now(), entryPrice, parentId });
        log.push(...step.transitions);
      }
      return {
        engine: { ...engine },
        transitions: [...prev.transitions, ...log].slice(-MAX_TRANSITIONS),
      };
    });
    /* Local mode cannot fail — the engine is right here, not over a network. */
    return true;
  }, [server, pull]);

  const armEntry = useCallback<Ctx["armEntry"]>(async ({ rule, market: raw, referencePrice, side }) => {
    const m = key(raw);
    if (server) {
      const now = Date.now();
      const ok = await armRemote(token.current, [
        {
          version: 1,
          id: rule.id,
          market: m,
          side,
          parentId: null,
          trigger: rule.trigger,
          amount: rule.amount,
          state: "armed",
          armedAt: now,
          expiresAt: now,
          entryPrice: referencePrice,
          highWater: null,
          attempts: 0,
        },
      ]);
      if (ok) void pull();
      return ok;
    }

    setState((prev) => {
      const engine = prev.engine;
      const step = arm(engine, {
        rule,
        market: m,
        at: Date.now(),
        side,
        entryPrice: referencePrice,
      });
      return {
        engine: { ...engine },
        transitions: [...prev.transitions, ...step.transitions].slice(-MAX_TRANSITIONS),
      };
    });
    return true;
  }, [server, pull]);

  const bindEntry = useCallback<Ctx["bindEntry"]>((raw, entryPrice) => {
    const m = key(raw);
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
    if (server) {
      void cancelRemote(token.current, id).then((ok) => {
        if (ok) void pull();
      });
      return;
    }

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
      server,
      watching,
      armed: armedRules(state.engine),
      waiting: Object.values(state.engine.rules).filter((r) => r.state === "unbound"),
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
    [state, hydrated, server, watching, armExits, armEntry, bindEntry, cancelRule, clearAll],
  );

  return <TriggerContext.Provider value={value}>{children}</TriggerContext.Provider>;
}

export function useTriggers(): Ctx {
  const ctx = useContext(TriggerContext);
  if (!ctx) throw new Error("useTriggers must be used inside <TriggerProvider>");
  return ctx;
}

export { fireRule };
