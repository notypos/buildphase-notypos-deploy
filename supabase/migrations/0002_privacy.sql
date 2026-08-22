-- ClearLabel migration 0002 — privacy-driven schema change.
--
-- Health context (medications, conditions, pregnancy/lactation, age) is now a
-- SESSION input: collected per analysis, used for that analysis, never written.
-- Only supplements and saved Decision Cards persist.
--
-- The tables dropped below are removed rather than left unused on purpose. A
-- dormant table designed to hold medication names is an invitation to start
-- writing to it later, and it makes the privacy claim unverifiable by reading
-- the schema.
--
-- Safe to run more than once.

-- ============================================================
-- Remove stores for data we have decided not to keep
-- ============================================================
drop table if exists public.medications;
drop table if exists public.stack_scans;   -- findings could embed medication names

alter table public.profiles drop column if exists life_stage;

-- ============================================================
-- Supplements still persist — they are the saved CRUD surface
-- ============================================================
-- Multi-ingredient products (a multivitamin) need their contents to compute
-- cumulative nutrient totals across a stack. Two products each under the limit
-- can exceed it together, which is the failure a person cannot catch by reading
-- labels one at a time.
alter table public.stack_items
  add column if not exists ingredients jsonb;

comment on column public.stack_items.ingredients is
  'Array of {nutrient, amount, unit} parsed from a label or DSLD record. Used for cumulative upper-limit checks.';

-- ============================================================
-- Decision Cards — explicitly saved, medication names redacted by default
-- ============================================================
create table if not exists public.decision_cards (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users (id) on delete cascade,
  title                text not null,
  question             text,
  guidance             jsonb not null,   -- {evidence, uncertainty, marketing}
  citations            jsonb not null,   -- [{supplement, section, url}]
  questions_for_clinician text[],
  -- False by default. When false, medication names in the card text are replaced
  -- with "a medication you entered" before the row is written.
  includes_medications boolean not null default false,
  created_at           timestamptz not null default now()
);

create index if not exists decision_cards_user_idx
  on public.decision_cards (user_id, created_at desc);

alter table public.decision_cards enable row level security;

drop policy if exists "own cards" on public.decision_cards;
create policy "own cards" on public.decision_cards
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

comment on table public.decision_cards is
  'User-saved summaries. Medication names are redacted unless the user explicitly opted in at save time.';
