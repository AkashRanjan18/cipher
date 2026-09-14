-- cipher — the tables a rule has to survive in.
--
-- Run once against an empty database:
--   psql "$DATABASE_URL" -f apps/web/lib/db/schema.sql
--
-- Everything here exists because a rule must fire with the browser closed.
-- localStorage cannot do that: it lives in one tab on one machine, and the
-- machine is asleep at 3am when the stop should fire.

create table if not exists users (
  -- Privy's DID. Never generated here — the identity comes from the token.
  id          text primary key,
  created_at  timestamptz not null default now()
);

-- One paper account per user.
--
-- Numeric, not double precision. Binary floating point cannot represent 0.1,
-- and a ledger that is out by a cent per trade is a ledger nobody trusts by
-- the hundredth trade.
create table if not exists accounts (
  user_id       text primary key references users(id) on delete cascade,
  usdc          numeric(20, 8) not null,
  realised_usd  numeric(20, 8) not null,
  fees_usd      numeric(20, 8) not null,
  deposited_usd numeric(20, 8) not null,
  updated_at    timestamptz not null default now()
);

-- What is held, one row per market.
--
-- WAS TWO COLUMNS ON accounts: `sol` and `cost_basis`. One shelf, which is why
-- cipher could list every token on Solana and trade exactly one of them — the
-- ticket disabled itself on every market but SOL, because a buy would
-- otherwise have credited `sol` whatever the user clicked.
--
-- A row exists only while something is held. Going flat DELETES it rather than
-- writing a zero: otherwise the table accumulates a row for every coin ever
-- touched, and every read has to filter them out forever.
--
-- numeric(36, 18), wider than the cash columns, because a memecoin is not a
-- dollar. Nine decimals is normal on Solana and the quantities run to twelve
-- figures — 183,963,461 BONK for $500 — so the precision has to cover both
-- ends of the same column.
create table if not exists positions (
  user_id    text not null references users(id) on delete cascade,
  mint       text not null,
  qty        numeric(36, 18) not null,
  cost_basis numeric(36, 18) not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, mint)
);

create table if not exists fills (
  id           text primary key,
  user_id      text not null references users(id) on delete cascade,
  ts           bigint not null,
  -- WHICH COIN. The mint, never the symbol — anyone can mint a token called
  -- SOL. A fill without this was only readable because the ledger held one
  -- asset, and a trade history that cannot say what was traded is not one.
  mint         text not null,
  side         text not null check (side in ('buy', 'sell')),
  qty          numeric(36, 18) not null,
  price        numeric(36, 18) not null,
  fee_usd      numeric(20, 8) not null,
  realised_usd numeric(20, 8) not null,
  squawk       text,
  source       text not null
);
create index if not exists fills_by_user on fills (user_id, ts desc);
create index if not exists fills_by_market on fills (user_id, mint, ts desc);

-- The armed rules.
--
-- THRESHOLD AND DIRECTION ARE STORED, NOT DERIVED. In the browser the engine
-- keeps a sorted index in memory; a worker has no memory between ticks, so the
-- index has to be the database's. Writing the resolved threshold down at arm
-- time turns "which rules just crossed" into one indexed query instead of
-- loading every rule and resolving each one.
--
-- A trailing stop rewrites its own threshold as the high-water mark rises,
-- which is the only reason this column is ever updated after arming.
create table if not exists rules (
  id          text primary key,
  user_id     text not null references users(id) on delete cascade,
  market      text not null,
  side        text not null check (side in ('buy', 'sell')),
  -- The resting entry this exit waits for. Null when there isn't one.
  parent_id   text,
  trigger     jsonb not null,
  amount      jsonb not null,
  state       text not null check (
    state in ('unbound', 'armed', 'firing', 'filled', 'cancelled', 'expired', 'failed')
  ),
  armed_at    bigint not null,
  expires_at  bigint not null,
  entry_price numeric(20, 8),
  high_water  numeric(20, 8),
  attempts    int not null default 0,
  -- Resolved at bind time. Null for time-triggered rules, which the clock
  -- finds through expires_at and their own deadline instead.
  threshold   numeric(20, 8),
  direction   text check (direction in ('above', 'below')),
  deadline    bigint
);

-- The query the worker runs on every tick, made cheap.
--
-- Partial: only armed rules are ever searched, and they are a small fraction
-- of the table once the product has been running for a week. Without the
-- predicate the index carries every filled and cancelled rule forever.
create index if not exists rules_watching
  on rules (market, direction, threshold)
  where state = 'armed';

create index if not exists rules_deadlines
  on rules (deadline)
  where state = 'armed' and deadline is not null;

create index if not exists rules_by_user on rules (user_id, state);

-- The audit trail. APPEND ONLY — never updated, never deleted.
--
-- This is the evidence for "why did you sell my SOL". Every state change the
-- engine emits lands here with the price that caused it.
create table if not exists rule_transitions (
  id         bigserial primary key,
  rule_id    text not null,
  user_id    text not null,
  from_state text not null,
  to_state   text not null,
  at         bigint not null,
  reason     text not null,
  price      numeric(20, 8)
);
create index if not exists transitions_by_user on rule_transitions (user_id, at desc);

-- Proof the worker is alive.
--
-- A single row. The UI reads it and says "rules are not being watched right
-- now" when it goes stale, because silence is the one thing a user cannot act
-- on. A promise that a stop is being watched is worth exactly as much as the
-- evidence behind it.
create table if not exists heartbeat (
  id      int primary key default 1,
  beat_at timestamptz not null default now(),
  note    text,
  check (id = 1)
);
insert into heartbeat (id, beat_at) values (1, now()) on conflict (id) do nothing;

-- ── Markets and prices ──────────────────────────────────────────────────────
--
-- The mint is the identity, not the symbol. Anyone can mint a token called BONK
-- with the same logo for a couple of dollars; only the mint address is unique,
-- and it is what the engine keys a rule on.

create table if not exists markets (
  mint      text primary key,
  symbol    text not null,
  name      text not null,
  decimals  int  not null,
  verified  boolean not null default false,
  added_at  timestamptz not null default now()
);

-- The latest price per market. One row each, upserted.
--
-- block_id is the Solana slot the price was derived at, and it is not
-- decoration: a price that is merely FLAT looks exactly like a feed that has
-- died, and the slot is what separates them. It also orders concurrent writes —
-- two workers can write the same mint in the same second with prices from
-- different slots, and the older one must not win.
create table if not exists market_prices (
  mint          text primary key,
  usd           numeric(30, 12) not null,
  block_id      bigint not null,
  liquidity_usd numeric(20, 2),
  change_24h    numeric(12, 4),
  at            bigint not null
);

-- Append-only price history, sampled into ten-second buckets.
--
-- Two jobs. It is the audit trail for the FEED — a fire at $71 is defensible
-- if the feed was moving and indefensible if it had been stuck for ten minutes,
-- and only this can tell them apart. And it is the raw material for candles on
-- tokens no data vendor covers, which is every interesting one. The bucket is
-- part of the key so repeated writes inside one bucket collapse to a single
-- row rather than a row per user per second for a number identical across all
-- of them.
create table if not exists price_ticks (
  mint     text not null,
  bucket   bigint not null,
  usd      numeric(30, 12) not null,
  block_id bigint not null,
  primary key (mint, bucket)
);
create index if not exists ticks_by_mint on price_ticks (mint, bucket desc);
