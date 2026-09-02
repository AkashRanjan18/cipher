# cipher

**cipher.family — from thoughts to trade**

A rules engine for crypto positions. You decide the exit once, while calm.
The system executes it while you're not.

    LAYER 1   fomo feature set     proven, table stakes
    LAYER 2   event tokens         supported asset class
    LAYER 3   cipher rules engine  the differentiator

The name is the mechanism: a cipher encodes one thing into another, and the
compiler encodes a sentence into a live order.

## Layout

    apps/web         Next.js — terminal UI, round-trip scanner, share cards
    packages/        shared rule schema and types
    services/        trigger engine, relayer             (phase 3)
    programs/        Anchor — event-token vault          (phase 4)

## Build order

    phase 0   round-trip scanner + share cards           ~1 week
    phase 1   rules engine on Hyperliquid                6-8 weeks
    phase 2   social layer: referrals, leaderboard, feed
    phase 3   Solana memecoin leg: relayer, trigger engine
    phase 4   event tokens: vault, LMSR, Pyth resolution
    phase 5   copy trading, clans, mobile, fiat on-ramp

## Non-negotiables

    - US geoblock from day one
    - price-resolved event markets only in v1
    - non-custodial, always
    - the LLM never touches the execution path
    - the relayer validates every transaction before it signs

## Commands

    npm run dev         start the web app
    npm test            run the scanner engine tests
    npm run typecheck

## Environment

Create `apps/web/.env.local`:

    HELIUS_API_KEY=      # wallet transaction history
    BIRDEYE_API_KEY=     # per-token OHLCV price series
    ANTHROPIC_API_KEY=   # prompt compiler (phase 1)
