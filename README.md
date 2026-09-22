# cipher

**cipher.family — from thoughts to trade**

A Solana trading terminal you talk to. Say what you want in one sentence and
cipher compiles it into live orders — the entry, the stop loss and the target
together — then watches the price and fires them server-side.

    "buy $500 of SOL and set a stop loss of 10%"
    "buy 5 sol, sell 30% at $120 and stop at $100"
    "put a hundred in, cut me if I'm wrong by ten percent"

Live: **https://cipher-eosin-beta.vercel.app**

Money is a $10,000 paper account. **Everything else is real**: live Solana
prices, real Jupiter routes and quotes, real price impact, and a trigger
engine that fires stops and targets from a server with every browser closed.

---

## What works today

**The prompt bar.** Type or speak an order. Two readers compile it:

- a **deterministic parser** (`lib/compiler/grammar.ts`) — under 10ms, free,
  no network, and no chance of a misread;
- an **open LLM** (`lib/compiler/llm.ts`) — Groq first, OpenRouter as backup,
  any OpenAI-compatible provider by environment variable. It reads the
  phrasings rules cannot cover ("get me out of half at two x").

The model **only fills in an order form**. It never executes anything, and
anything it returns that is not an order becomes one fixed sentence:
*"I only place orders — I can't help with that."*

**Nothing executes on a guess.** Between reading and executing:

- **every number said must appear in the order**, or nothing runs and cipher
  names the number it could not place;
- a price more than 50% from the market is questioned, not armed;
- an ambiguous size is asked about (`"$5 or 5 SOL?"`), and **the answer keeps
  the rest of the order** — the stop and target survive the question;
- a sell needs the tokens held; a buy needs the cash.

**Orders that wait.** Buy limits, stop losses and targets rest in Postgres and
fire from `/api/tick`, called every minute by cron. Exactly-once claiming, an
append-only audit trail, retries, expiry, and cancellation of stale exits when
a position goes flat.

**Positions.** Open, Pending and Closed on one card layout: quantity, token,
trigger price and live price, both with market caps, and Cancel or Sell.

**Voice.** Deepgram transcribes spoken orders with the coin names on screen as
hints; a normaliser fixes how people say numbers ("one twenty" → 120,
"81.5k" → 81,500, "negative ten percent" → −10%).

**Execution quality.** Every fill is quoted against real Jupiter routes, and
price impact is **measured** against a same-moment reference quote rather than
taken from a field that proved unreliable — a bug that refused a valid $500
order as "6.7% impact" when the true figure was 0.5%. Audited across all 119
listed tokens (`scripts/impact-audit.ts`).

### Order types

    sell stop loss   triggers at the price; sells AT OR BELOW it — no floor
    sell target      sells AT OR ABOVE the price — never below
    sell limit       the same thing as a sell target
    buy limit        buys AT OR BELOW the price — never above, and must be
                     placed below the market (there is no buy stop)

Spot only, no shorting: a sell needs the tokens. A sell for more than is held
**waits** ("Triggers when you have 1.5 SOL") rather than selling part of it.
A percentage freezes into a token quantity when the order is placed.

### Fees

    $0.95 flat under $200 of trade, 0.50% from $200 up

Taken **out of** the amount: "$500" spends $500 in total — $497.51 into the
trade, $2.49 of fee. Network and pool costs are inside the execution price;
cipher adds nothing on top.

---

## Stack

    Next.js 16 (App Router, Turbopack) · React 19 · TypeScript · Tailwind 4
    PostgreSQL (Neon) + PGlite for in-process integration tests
    Jupiter (quotes, routes, token data) · Privy (auth + embedded wallets)
    Deepgram nova-3 (speech) · Groq / OpenRouter (open models)
    lightweight-charts · Vercel + cron-job.org

    ~16,000 lines of TypeScript, 396 tests, no test framework dependency
    (node --experimental-strip-types --test)

## Layout

    apps/web/
      app/                  routes and API handlers (authorisation only)
        api/tick            the trigger worker's entry point (cron)
        api/compile         the model fallback, rate-limited, signed in
        api/trade           quote + execute against the paper ledger
      components/trade/     terminal, chart, ticket, positions, prompt bar
      lib/
        account/            paper ledger: fees, fills, positions, round trips
        chain/              Jupiter quotes, prices, token metadata
        compiler/           grammar, model, validation, readback, routing
        triggers/           engine seam, store, server worker
        voice/              speech normalisation
      scripts/              impact audit, prompt edge-case battery
    packages/shared/        order schema, intent union, trigger engine

## Commands

    npm run dev         start the web app
    npm test            run every test (engine, compiler, ledger, worker)
    npm run typecheck

    # live checks (spend real API calls, not part of npm test)
    node --env-file=.env.local --experimental-strip-types scripts/edge-battery.ts
    node --env-file=.env.local --experimental-strip-types scripts/impact-audit.ts 500

## Environment

`apps/web/.env.local`:

    NEXT_PUBLIC_PRIVY_APP_ID=     # auth + embedded wallets
    PRIVY_APP_SECRET=
    DATABASE_URL=                 # Neon Postgres, pooled
    CRON_SECRET=                  # guards /api/tick
    JUPITER_API_KEY=              # quotes and token data
    DEEPGRAM_API_KEY=             # voice orders
    GROQ_API_KEY=                 # the model fallback
    OPENROUTER_API_KEY=           # its backup

Every one is optional except the database and Privy: with no model key the
prompt bar runs on the parser alone, and with no Deepgram key voice falls back
to the browser's own recogniser.

## Not built yet

    real money            no transaction is signed or sent anywhere
    delegate authority    the permission that lets stops fire on chain
    perps, prediction markets, copy trading, the social layer
    a prompt log          every sentence, for measuring and improving the parser

`CLAUDE.md` carries the decisions, the rulebook and the traps — read it before
changing anything here.
