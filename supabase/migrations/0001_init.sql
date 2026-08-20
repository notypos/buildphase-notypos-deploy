-- ClearLabel — initial schema
-- Run in the Supabase SQL editor. Safe to re-run.

create extension if not exists vector;
create extension if not exists pgcrypto;

-- ============================================================
-- Corpus: NIH ODS fact sheets
-- ============================================================
create table if not exists public.fact_sheets (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,          -- 'VitaminD-Consumer'
  supplement    text not null,                 -- 'Vitamin D'
  audience      text not null,                 -- 'consumer' | 'health_professional'
  language      text not null default 'en',    -- 'en' | 'es'
  title         text,
  source_url    text not null,
  content_hash  text,                          -- skip re-embedding unchanged sheets
  fetched_at    timestamptz not null default now()
);

create index if not exists fact_sheets_supplement_idx
  on public.fact_sheets (supplement, audience, language);

-- Chunks are section-scoped so a citation can name its heading.
create table if not exists public.chunks (
  id             uuid primary key default gen_random_uuid(),
  fact_sheet_id  uuid not null references public.fact_sheets (id) on delete cascade,
  section        text,        -- H2
  subsection     text,        -- H3, nullable
  ordinal        int not null,
  content        text not null,
  token_estimate int,
  embedding      vector(768)  -- Gemini text-embedding-004
);

create index if not exists chunks_fact_sheet_idx on public.chunks (fact_sheet_id);
create index if not exists chunks_embedding_idx
  on public.chunks using hnsw (embedding vector_cosine_ops);

-- Parsed from each sheet's RDA / Upper Limit tables. Powers the My Stack
-- overdose check without asking the model to recall numbers.
create table if not exists public.nutrient_limits (
  id            uuid primary key default gen_random_uuid(),
  fact_sheet_id uuid references public.fact_sheets (id) on delete cascade,
  supplement    text not null,
  life_stage    text not null,   -- '19-50 years', 'Pregnant teens', ...
  sex           text,            -- 'male' | 'female' | null
  rda_amount    numeric,
  rda_unit      text,
  ul_amount     numeric,
  ul_unit       text
);

create index if not exists nutrient_limits_supplement_idx
  on public.nutrient_limits (supplement);

-- Corpus tables are public read; only the service role writes them.
alter table public.fact_sheets     enable row level security;
alter table public.chunks          enable row level security;
alter table public.nutrient_limits enable row level security;

drop policy if exists "corpus readable" on public.fact_sheets;
create policy "corpus readable" on public.fact_sheets for select using (true);
drop policy if exists "corpus readable" on public.chunks;
create policy "corpus readable" on public.chunks for select using (true);
drop policy if exists "corpus readable" on public.nutrient_limits;
create policy "corpus readable" on public.nutrient_limits for select using (true);

-- ============================================================
-- Users
-- ============================================================
create table if not exists public.profiles (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  display_name  text,
  audience_mode text not null default 'adult',  -- teen|adult|older_adult|caregiver
  language      text not null default 'en',     -- en|es
  age_band      text,
  life_stage    text,                           -- none|pregnant|postpartum
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.stack_items (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  label_name    text not null,        -- as printed on the bottle
  supplement    text,                 -- normalized, joins nutrient_limits
  fact_sheet_id uuid references public.fact_sheets (id) on delete set null,
  dsld_id       text,                 -- NIH DSLD product id when scanned
  dose_amount   numeric,
  dose_unit     text,
  frequency     text default 'daily',
  created_at    timestamptz not null default now()
);

create index if not exists stack_items_user_idx on public.stack_items (user_id);

create table if not exists public.medications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now()
);

create index if not exists medications_user_idx on public.medications (user_id);

-- ============================================================
-- Conversations
-- ============================================================
create table if not exists public.conversations (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  title      text,
  created_at timestamptz not null default now()
);

create index if not exists conversations_user_idx
  on public.conversations (user_id, created_at desc);

create table if not exists public.messages (
  id                 uuid primary key default gen_random_uuid(),
  conversation_id    uuid not null references public.conversations (id) on delete cascade,
  role               text not null,   -- 'user' | 'assistant'
  content            text not null,
  cards              jsonb,           -- {evidence, uncertainty, marketing}
  citations          jsonb,           -- [{fact_sheet_id, slug, section, url}]
  retrieved_chunk_ids uuid[],         -- traceability: what retrieval actually returned
  audience_mode      text,
  language           text,
  refused            boolean not null default false,
  created_at         timestamptz not null default now()
);

create index if not exists messages_conversation_idx
  on public.messages (conversation_id, created_at);

create table if not exists public.claim_checks (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  claim_text text not null,
  verdict    text,   -- supported | mixed | not_supported | no_ods_data
  strength   text,   -- strong | moderate | limited | insufficient
  rationale  text,
  citations  jsonb,
  created_at timestamptz not null default now()
);

create index if not exists claim_checks_user_idx
  on public.claim_checks (user_id, created_at desc);

-- Output of an agent run over a user's stack.
create table if not exists public.stack_scans (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  findings   jsonb not null,  -- [{kind:'upper_limit'|'interaction'|'life_stage', severity, ...}]
  created_at timestamptz not null default now()
);

create index if not exists stack_scans_user_idx
  on public.stack_scans (user_id, created_at desc);

-- ============================================================
-- RLS — every user table is owner-only
-- ============================================================
alter table public.profiles     enable row level security;
alter table public.stack_items  enable row level security;
alter table public.medications  enable row level security;
alter table public.conversations enable row level security;
alter table public.claim_checks enable row level security;
alter table public.stack_scans  enable row level security;
alter table public.messages     enable row level security;

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own stack" on public.stack_items;
create policy "own stack" on public.stack_items
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own meds" on public.medications;
create policy "own meds" on public.medications
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own conversations" on public.conversations;
create policy "own conversations" on public.conversations
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own claims" on public.claim_checks;
create policy "own claims" on public.claim_checks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own scans" on public.stack_scans;
create policy "own scans" on public.stack_scans
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Messages inherit ownership through their conversation.
drop policy if exists "own messages" on public.messages;
create policy "own messages" on public.messages
  for all using (
    exists (select 1 from public.conversations c
            where c.id = messages.conversation_id and c.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.conversations c
            where c.id = messages.conversation_id and c.user_id = auth.uid())
  );

-- ============================================================
-- Auto-create a profile row on signup
-- ============================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- Vector search
-- ============================================================
-- Returns cosine similarity (1 = identical). The API layer applies the
-- refusal threshold; this just ranks.
create or replace function public.match_chunks(
  query_embedding vector(768),
  match_count     int  default 8,
  filter_audience text default null,
  filter_language text default 'en',
  min_similarity  float default 0.0
)
returns table (
  chunk_id      uuid,
  fact_sheet_id uuid,
  slug          text,
  supplement    text,
  section       text,
  subsection    text,
  content       text,
  source_url    text,
  similarity    float
)
language sql stable as $$
  select
    c.id, fs.id, fs.slug, fs.supplement, c.section, c.subsection,
    c.content, fs.source_url,
    1 - (c.embedding <=> query_embedding) as similarity
  from public.chunks c
  join public.fact_sheets fs on fs.id = c.fact_sheet_id
  where c.embedding is not null
    and (filter_audience is null or fs.audience = filter_audience)
    and (filter_language is null or fs.language = filter_language)
    and 1 - (c.embedding <=> query_embedding) >= min_similarity
  order by c.embedding <=> query_embedding
  limit match_count;
$$;
