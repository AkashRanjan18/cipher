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
import { usePrivy } from "@privy-io/react-auth";
import { openAccount, execute, type Account, type Fill } from "./paper";
import { fireRule, type Outcome } from "../triggers/execute";
import { fetchSnapshot, fetchSnapshotResult, resetRemote, tradeRemote } from "../db/remote";
import type { Rule } from "@cipher/shared";

/**
 * The paper account, held in React and persisted to the browser.
 *
 * Split from paper.ts on purpose: everything that can be tested without a
 * browser lives there, and everything that cannot lives here. This file has
 * no money math in it at all — it stores, loads, and hands the engine a clock.
 *
 * cipher: localStorage, so the account is per-browser and per-device. It
 * survives refreshes and deploys, not a cleared cache or a second laptop.
 * When accounts exist server-side this file changes and nothing else does.
 */

/** The opening balance. */
export const OPENING_DEPOSIT = 10_000;

/*
 * Versioned key. If the Account shape ever changes, bump this rather than
 * writing a migration — old state is then ignored instead of being read into
 * the new shape and producing a balance that is wrong in a way nobody can see.
 */
const KEY = "cipher.paper.v2";

interface Ctx {
  account: Account;
  /**
   * True when the account lives in Postgres rather than in this browser.
   *
   * It matters to the UI: in server mode a balance can change while nobody is
   * looking, because a rule fired. In local mode it cannot.
   */
  server: boolean;
  /**
   * False until localStorage has been read. The UI must show "—" rather than
   * the opening balance while this is false: the server renders $10,000, and
   * flashing that before correcting to the real number is, for one frame, a
   * screen telling someone they have money they do not have.
   */
  hydrated: boolean;
  /** Returns the fill, or a sentence explaining why it did not happen. */
  trade(input: {
    /**
     * WHICH COIN. Required, and deliberately not defaulted.
     *
     * A default would be the old bug with extra steps: every caller that
     * forgot would credit one particular market, which is exactly how "buy
     * BTC" used to hand someone SOL. Making it required means the compiler
     * finds every call site instead of the user finding one of them.
     */
    mint: string;
    side: "buy" | "sell";
    qty: number;
    mark: number;
    /** For refusal sentences only. Never an identity. */
    symbol?: string;
    squawk?: string;
    source?: Fill["source"];
    /* Execution conditions. Passed straight through to the engine — the
       ticket's gear and a sentence's "max 3% slippage" arrive the same way. */
    depthUsd?: number | null;
    slippageBps?: number;
  }): Promise<{ fill: Fill } | { refusal: string }>;
  /**
   * Execute a rule the trigger engine says is due.
   *
   * Here rather than in the trigger store, because the account has to stay the
   * only thing that writes the account. A runner holding its own copy and
   * handing back a new one would race with the ticket the moment a stop fires
   * while someone is mid-order — two writers, last one wins, and the loser is
   * a trade that silently never happened.
   *
   * It returns the seam's three-way Outcome untouched. Deciding what `moot`
   * means is the runner's job; this only moves money.
   */
  fire(rule: Rule, ctx: { mark: number; depthUsd?: number | null; slippageBps?: number }): Outcome;
  reset(): void;
}

const AccountContext = createContext<Ctx | null>(null);

function load(): Account | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Account;
    /*
     * Shape check, not a schema. Corrupt state should reset, never throw.
     *
     * `positions` IS CHECKED, and the reason is a crash. The ledger went from
     * one asset to a map keyed by mint, an account stored under the old key
     * came back with no `positions` at all, and `Object.keys(undefined)` took
     * the whole terminal down behind a runtime error. The version bump above
     * is the real fix — old state is ignored rather than read into the new
     * shape — and this is the guard for the case the bump cannot cover: state
     * written by a build that is newer, older, or simply wrong.
     */
    if (
      typeof parsed?.usdc !== "number" ||
      !Array.isArray(parsed.fills) ||
      typeof parsed.positions !== "object" ||
      parsed.positions === null
    ) {
      return null;
    }

    /*
     * The prompt bar was called Polly and is now Sana, and Fill.source is a
     * PERSISTED string — so every fill already sitting in a browser still says
     * "polly" and would quietly stop being recognised as prompt-placed.
     *
     * Rewriting it on read rather than leaving the old value in the union: a
     * type that carries a dead name forever is how a rename becomes permanent
     * technical debt. This costs one pass over an array that is at most a few
     * hundred long, and it can be deleted once nobody has a pre-rename
     * account — which, for paper money with a Reset button, is soon.
     */
    for (const f of parsed.fills) {
      if ((f.source as string) === "polly") f.source = "sana";
    }

    return parsed;
  } catch {
    return null;
  }
}

export function PaperAccountProvider({ children }: { children: ReactNode }) {
  const { authenticated, getAccessToken } = usePrivy();
  const [account, setAccount] = useState<Account>(() => openAccount(OPENING_DEPOSIT));
  const [hydrated, setHydrated] = useState(false);
  const [server, setServer] = useState(false);
  const token = useRef<string | null>(null);

  /*
   * THE ACCOUNT, READABLE SYNCHRONOUSLY.
   *
   * `trade` and `fire` have to return what happened, and a setState updater
   * cannot hand a value back. The previous version captured the outcome out of
   * the updater and read it afterwards, on the stated claim that React runs
   * the updater synchronously. IT DOES NOT. React runs it eagerly only as a
   * bail-out optimisation, and only while no other update is already queued —
   * so the code worked in local mode and broke the moment the five-second
   * snapshot poll started keeping one queued. Every order placed through Sana
   * came back "Nothing happened." while the trade had never run.
   *
   * A ref is the honest version: read the current account, compute the next
   * one, write both. It depends on nothing about React's internals.
   */
  const latest = useRef(account);

  /*
   * Server mode, mirrored into a ref.
   *
   * `trade` is handed to every consumer through context, so it has to stay
   * referentially stable — which means an empty dependency list, which means
   * it captured `server` from the first render, which is always false. It was
   * therefore stuck in LOCAL mode forever: signed in, rows in Postgres, and a
   * ledger being written to a browser nobody reads. State drives rendering;
   * the ref is what a stable callback is allowed to read.
   */
  const serverRef = useRef(false);

  const commit = useCallback((next: Account) => {
    latest.current = next;
    setAccount(next);
  }, []);

  /*
   * SERVER MODE, decided by whether the server answers — AND RETRIED.
   *
   * Not by a feature flag and not by whether the user is signed in: signed in
   * with no DATABASE_URL is a perfectly ordinary state, and the right answer
   * there is the local account rather than an error.
   *
   * BUT "ask once and believe the reply" was wrong, and the failure was seen
   * rather than imagined. One request landing on a route that was still
   * compiling left the session permanently local — showing a balance out of
   * localStorage while Postgres held a different one, and while the worker
   * went on acting on the Postgres copy. Two ledgers, one screen, no warning.
   * The screenshot said 10.11 SOL; the database said flat.
   *
   * `fetchSnapshotResult` already separates the two cases and this threw the
   * distinction away by calling `fetchSnapshot`, which collapses both to null:
   *
   *   unconfigured   503 or 401. No database, or not a session. Permanent —
   *                  asking again in a second cannot change either.
   *   unavailable    anything else. A cold route, a dropped connection, a
   *                  restart. Transient by definition, so retry.
   */
  useEffect(() => {
    if (!authenticated) {
      token.current = null;
      serverRef.current = false;
      setServer(false);
      return;
    }
    let alive = true;
    void (async () => {
      const t = await getAccessToken();
      if (!alive) return;
      token.current = t;

      /* Backing off rather than hammering: a server that is starting up wants
         a second, and a server that is down is not helped by five requests. */
      for (const wait of [0, 400, 1200, 3000, 6000]) {
        if (wait) await new Promise((r) => setTimeout(r, wait));
        if (!alive) return;

        const result = await fetchSnapshotResult(t);
        if (!alive) return;

        if (result.kind === "unconfigured") return; // local, correctly.
        if (result.kind === "ok" && result.snapshot.account) {
          serverRef.current = true;
          setServer(true);
          commit(result.snapshot.account);
          setHydrated(true);
          return;
        }
      }
      console.warn("[cipher] server account unreachable; staying local this session");
    })();
    return () => {
      alive = false;
    };
  }, [authenticated, getAccessToken]);

  /*
   * Re-read after a rule may have fired.
   *
   * A stop firing in the worker changes the balance with nobody looking, and
   * the header would otherwise keep showing the number from before it. Same
   * five seconds as the rules poll, and cheap: one row.
   */
  useEffect(() => {
    if (!server) return;
    const id = window.setInterval(() => {
      void fetchSnapshot(token.current).then((snap) => {
        if (snap?.account) commit(snap.account);
      });
    }, 5_000);
    return () => window.clearInterval(id);
  }, [server]);

  // Read stored state after mount. Reading it during render breaks SSR.
  useEffect(() => {
    if (server) return;
    commit(load() ?? openAccount(OPENING_DEPOSIT));
    setHydrated(true);
  }, [server, commit]);

  // Write on every change, but never before the read — that would persist the
  // opening balance over a real one on the first frame after mount.
  useEffect(() => {
    /* The rows are the account in server mode; a localStorage copy would be a
       stale shadow read back on the next cold start. */
    if (server || !hydrated) return;
    try {
      window.localStorage.setItem(KEY, JSON.stringify(account));
    } catch {
      /* Private windows and blocked site data. The session still works. */
    }
  }, [account, hydrated, server]);

  const trade = useCallback<Ctx["trade"]>(async (input) => {
    /*
     * ASYNC, because over a network it is.
     *
     * This used to return synchronously, which was honest while the ledger was
     * a local object and became a lie the moment it moved to Postgres. Every
     * caller is already in an event handler, so awaiting costs nothing but the
     * signature had to tell the truth.
     */
    if (serverRef.current) {
      const r = await tradeRemote(token.current, input);
      if (!r) return { refusal: "Couldn't reach the server. Nothing happened." };
      if ("refusal" in r) return r;
      commit(r.account);
      return { fill: r.fill };
    }

    const r = execute(latest.current, { ...input, ts: Math.floor(Date.now() / 1000) });
    if ("refusal" in r) return r;
    commit(r.account);
    return { fill: r.fill };
  }, [commit]);

  const fire = useCallback<Ctx["fire"]>((rule, ctx) => {
    const r = fireRule(latest.current, rule, { ...ctx, ts: Math.floor(Date.now() / 1000) });
    if (r.kind === "filled") commit(r.account);
    return r;
  }, [commit]);

  const reset = useCallback(() => {
    if (server) {
      void resetRemote(token.current).then((a) => {
        if (a) commit(a);
      });
      return;
    }
    commit(openAccount(OPENING_DEPOSIT));
  }, [server, commit]);

  const value = useMemo(
    () => ({ account, hydrated, server, trade, fire, reset }),
    [account, hydrated, server, trade, fire, reset],
  );

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function usePaperAccount(): Ctx {
  const ctx = useContext(AccountContext);
  if (!ctx) throw new Error("usePaperAccount must be used inside <PaperAccountProvider>");
  return ctx;
}
