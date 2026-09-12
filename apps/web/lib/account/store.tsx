"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { openAccount, execute, type Account, type Fill } from "./paper";

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
const KEY = "cipher.paper.v1";

interface Ctx {
  account: Account;
  /**
   * False until localStorage has been read. The UI must show "—" rather than
   * the opening balance while this is false: the server renders $10,000, and
   * flashing that before correcting to the real number is, for one frame, a
   * screen telling someone they have money they do not have.
   */
  hydrated: boolean;
  /** Returns the fill, or a sentence explaining why it did not happen. */
  trade(input: {
    side: "buy" | "sell";
    qty: number;
    mark: number;
    squawk?: string;
    source?: Fill["source"];
    /* Execution conditions. Passed straight through to the engine — the
       ticket's gear and a sentence's "max 3% slippage" arrive the same way. */
    depthUsd?: number | null;
    slippageBps?: number;
  }): { fill: Fill } | { refusal: string };
  reset(): void;
}

const AccountContext = createContext<Ctx | null>(null);

function load(): Account | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Account;
    // Shape check, not a schema. Corrupt state should reset, never throw.
    if (typeof parsed?.usdc !== "number" || !Array.isArray(parsed.fills)) return null;

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
  const [account, setAccount] = useState<Account>(() => openAccount(OPENING_DEPOSIT));
  const [hydrated, setHydrated] = useState(false);

  // Read stored state after mount. Reading it during render breaks SSR.
  useEffect(() => {
    setAccount(load() ?? openAccount(OPENING_DEPOSIT));
    setHydrated(true);
  }, []);

  // Write on every change, but never before the read — that would persist the
  // opening balance over a real one on the first frame after mount.
  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(KEY, JSON.stringify(account));
    } catch {
      /* Private windows and blocked site data. The session still works. */
    }
  }, [account, hydrated]);

  const trade = useCallback<Ctx["trade"]>((input) => {
    /*
     * The refusal has to escape this callback, and setState's updater cannot
     * return one. So the result is captured out of the updater and read after
     * — safe because React calls the updater synchronously here, and because
     * a refusal returns the identical account object, so nothing re-renders.
     */
    let out: { fill: Fill } | { refusal: string } = { refusal: "Nothing happened." };
    setAccount((prev) => {
      const r = execute(prev, { ...input, ts: Math.floor(Date.now() / 1000) });
      if ("refusal" in r) {
        out = r;
        return prev;
      }
      out = { fill: r.fill };
      return r.account;
    });
    return out;
  }, []);

  const reset = useCallback(() => setAccount(openAccount(OPENING_DEPOSIT)), []);

  const value = useMemo(
    () => ({ account, hydrated, trade, reset }),
    [account, hydrated, trade, reset],
  );

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function usePaperAccount(): Ctx {
  const ctx = useContext(AccountContext);
  if (!ctx) throw new Error("usePaperAccount must be used inside <PaperAccountProvider>");
  return ctx;
}
