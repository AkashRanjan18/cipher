# PBT — Prompt Based Trading

A rules engine for crypto positions. You decide the exit once, while calm.
The system executes it while you're not.

    LAYER 1   fomo feature set     proven, table stakes
    LAYER 2   event tokens         the hook
    LAYER 3   PBT rules engine     the differentiator

## Layout

    apps/web         Next.js — terminal UI, round-trip scanner, share cards
    packages/shared  rule schema, shared types
    services/        trigger engine, relayer  (phase 3)
    programs/        Anchor — event-token vault  (phase 4)

## Build order

    phase 0   round-trip scanner + share cards          45h
    phase 1   PBT on Hyperliquid (native TP/SL)        140h
    phase 2   fomo layer: referrals, leaderboard, feed 120h
    phase 3   Solana memecoin leg                      260h
    phase 4   event tokens (vault, LMSR, Pyth)         200h
    phase 5   fomo layer: copytrading, clans, mobile   400h+

## Non-negotiables

    - US geoblock from day one
    - price-resolved markets only in v1
    - non-custodial, always
