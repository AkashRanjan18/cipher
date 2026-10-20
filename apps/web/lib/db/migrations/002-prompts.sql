-- The prompt log. See the commented block in schema.sql for why it exists.
--
-- Separate from schema.sql because Neon already has the other tables: running
-- the whole schema again is safe (every statement is `if not exists`) but a
-- migration file is the honest record of what changed and when.
create table if not exists prompts (
  id        bigserial primary key,
  user_id   text,
  at        bigint not null,
  text      text   not null,
  reader    text   not null,
  provider  text,
  kind      text   not null,
  reason    text,
  spec      jsonb,
  outcome   text   not null,
  market    text,
  ms        int
);
create index if not exists prompts_by_time on prompts (at desc, id desc);
create index if not exists prompts_by_user on prompts (user_id, at desc);
