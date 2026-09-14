-- 001 — one shelf becomes many.
--
-- `accounts.sol` and `accounts.cost_basis` held the only position a user could
-- have. This moves what is there into `positions`, keyed by mint, and gives
-- `fills` the mint column it should always have had.
--
-- SAFE TO RE-RUN. Every step is guarded, so a half-applied migration finishes
-- rather than failing, and a fully-applied one does nothing.
--
-- NOTHING IS DROPPED HERE. The old columns stay until the data has been read
-- back and checked — see the note at the bottom. A migration that deletes the
-- only copy of a balance in the same breath as moving it leaves no way back
-- if the move was wrong.

-- ── the new home ────────────────────────────────────────────────────────────
create table if not exists positions (
  user_id    text not null references users(id) on delete cascade,
  mint       text not null,
  qty        numeric(36, 18) not null,
  cost_basis numeric(36, 18) not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, mint)
);

-- ── move what is held ───────────────────────────────────────────────────────
--
-- Only rows with something in them. A user who is flat gets no row, which is
-- the invariant the whole table depends on: a position exists while it is
-- held, and going flat deletes it rather than writing a zero.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'accounts' and column_name = 'sol'
  ) then
    insert into positions (user_id, mint, qty, cost_basis)
    select
      user_id,
      -- Every legacy position was SOL. There was no other option.
      'So11111111111111111111111111111111111111112',
      sol,
      cost_basis
    from accounts
    where sol > 0
    on conflict (user_id, mint) do nothing;
  end if;
end $$;

-- ── fills learn what they traded ────────────────────────────────────────────
--
-- Backfilled to SOL rather than left null: every existing fill IS a SOL fill,
-- and a nullable mint would mean every reader forever carrying a branch for
-- rows that predate this migration.
alter table fills add column if not exists mint text;
update fills set mint = 'So11111111111111111111111111111111111111112' where mint is null;
alter table fills alter column mint set not null;

create index if not exists fills_by_market on fills (user_id, mint, ts desc);

-- ── the old columns stop being required ─────────────────────────────────────
--
-- KEEPING THEM IS NOT THE SAME AS LEAVING THEM ALONE. They are `not null` with
-- no default, and nothing writes them any more — so the first `ensureUser` after
-- this migration failed with
--
--   null value in column "sol" of relation "accounts" violates not-null constraint
--
-- and every /api/rules request 500'd, which put the whole app silently into
-- local mode: a browser trading against localStorage while Postgres held a
-- different balance. Dropping the constraint keeps the historical values
-- readable and lets new rows exist without them.
alter table accounts alter column sol drop not null;
alter table accounts alter column cost_basis drop not null;

-- ── room for a memecoin ─────────────────────────────────────────────────────
--
-- numeric(20, 8) fits SOL and does not fit BONK: $500 buys 183,963,461 units
-- and the prices run to twelve decimal places. Widening is lossless.
alter table fills alter column qty type numeric(36, 18);
alter table fills alter column price type numeric(36, 18);

-- ── deliberately NOT done yet ───────────────────────────────────────────────
--
--   alter table accounts drop column sol;
--   alter table accounts drop column cost_basis;
--
-- Left in place on purpose. They are now unread by every query in lib/db, so
-- they cost a few bytes and nothing else, and they are the only record of what
-- the balance was before this ran. Drop them in a later migration once a
-- release has gone by and the positions table has been trusted with real
-- trades — not in the same migration that moved the data.
