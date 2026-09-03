# cipher

**cipher.family — from thoughts to trade**

A social trading app you talk to. Say what you want in a sentence and cipher
configures the trade, places it, and manages it — no menus, no settings, no
leverage sliders.

    "buy me $500 of bonk, sell a third at 2x and stop the rest at -50%"

The name is the mechanism: a cipher encodes one thing into another, and the
compiler encodes a sentence into a live order.

## What makes it different

**1. You say it, we do it — for the operations people can't configure.**
Buying is two taps and nobody needs help with it. The value is in what has a
conceptual barrier: slippage tolerance, priority fees, private submission,
position sizing on spot; shorting, leverage, margin mode and liquidation
distance on perps. A person can understand "I think SOL goes down" and be
completely unable to operate that screen.

**2. Leaders are ranked and paid on how much they made other people.**
Not on their own P&L. Every other leaderboard ranks the leader's own gains,
which selects for the lucky and for people distributing to their followers.
Ranking on aggregate copier profit inverts it — and unlike your own returns,
other people's realised profits can't be faked without paying them real money.

Leaders earn 10% of copier profit, above a per-pair high-water mark.

## Layout

    apps/web         Next.js — landing, auth, trading UI, round-trip scanner
    packages/        shared order schema and types
    services/        trigger engine, relayer             (phase 1)
    programs/        Anchor — event-token vault          (phase 4)

## Build order

    phase 0   round-trip scanner + share cards       ~1 week
    phase 1   Solana memecoin engine                 3-4 months
              relayer, sharded trigger engine, delegate authority,
              Jito submission, depth-aware execution
    phase 2   social layer: profiles, feed, leaderboard, referrals
    phase 3   Hyperliquid + perps (native TP/SL, builder codes)
    phase 4   copy trading with profit share
    phase 5   clans, entity, fiat on-ramp, mobile, multichain

## Non-negotiables

    - OFAC jurisdictions blocked everywhere; US blocked from perps
      and event markets only — spot is non-custodial and open
    - non-custodial, always
    - the LLM never touches the execution path — it compiles once, at
      arm time, into a deterministic spec
    - no order arms without an approved plain-English readback
    - the relayer validates every transaction before it signs

## Commands

    npm run dev         start the web app
    npm test            run the scanner engine tests
    npm run typecheck

## Environment

Create `apps/web/.env.local`:

    NEXT_PUBLIC_PRIVY_APP_ID=   # auth + embedded wallets
    PRIVY_APP_SECRET=
    HELIUS_API_KEY=             # wallet transaction history
    BIRDEYE_API_KEY=            # per-token OHLCV price series
    ANTHROPIC_API_KEY=          # prompt compiler (phase 1)
