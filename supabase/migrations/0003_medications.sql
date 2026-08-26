-- ClearLabel migration 0003 — reintroduce medications, scoped to the new
-- interaction-check feature.
--
-- Migration 0002 deliberately dropped this table so that "we don't store
-- medications" was verifiable by reading the schema, not just a comment. That
-- design choice is reversed here at explicit user request: the interaction
-- check needs a saved, checkbox-able medication list, not a session-only one.
-- Documented plainly rather than silently — README/plan/design should be
-- updated to match (the "never collected" claim no longer holds for
-- medications specifically; conditions are still never collected at all).
--
-- Safe to run more than once.

create table if not exists public.medications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now()
);

create index if not exists medications_user_idx on public.medications (user_id);

alter table public.medications enable row level security;

drop policy if exists "own meds" on public.medications;
create policy "own meds" on public.medications
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

comment on table public.medications is
  'User-saved medication names for the interaction check against typed/scanned supplements. Reintroduced in 0003 after being dropped in 0002 for privacy reasons — an explicit, informed reversal for this one feature.';
