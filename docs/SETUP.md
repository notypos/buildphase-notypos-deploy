# ClearLabel setup

## 1. Supabase project

1. <https://supabase.com/dashboard> → **New project**.
2. Name it `clearlabel`. Pick the region closest to you. Save the database
   password somewhere — you won't need it for this app, but Supabase won't show
   it again.
3. Wait for provisioning (~2 min).

## 2. Enable pgvector

**Database → Extensions** → search `vector` → toggle it on.

Do this *before* running the migration. `create extension if not exists vector`
in the migration usually handles it, but the dashboard toggle is reliable.

## 3. Run the migration

**SQL Editor → New query** → paste all of
[`supabase/migrations/0001_init.sql`](../supabase/migrations/0001_init.sql) → **Run**.

Expect "Success. No rows returned."

Verify:

```sql
select table_name from information_schema.tables
where table_schema = 'public' order by table_name;
```

You should see: `chunks`, `claim_checks`, `conversations`, `fact_sheets`,
`medications`, `messages`, `nutrient_limits`, `profiles`, `stack_items`,
`stack_scans`.

## 4. Collect three values

**Project URL** — click **Connect** at the top of the dashboard (or Settings →
Data API). Looks like `https://abcdefghijklm.supabase.co`. No trailing path.

**Keys** — Settings → **API Keys**:

| Value | Where |
|---|---|
| publishable (`sb_publishable_…`) | API Keys tab. Safe in the browser. |
| secret (`sb_secret_…`) | API Keys tab — click to reveal. **Bypasses row-level security.** |

If your project only shows legacy keys, `anon` maps to publishable and
`service_role` maps to secret. Either generation works.

## 5. Gemini key

<https://aistudio.google.com/apikey> → Create API key. Free tier covers this
project's embedding volume comfortably.

## 6. Create `.env.local`

In the repo root:

```
copy .env.example .env.local
```

Windows Explorer hides dotfiles; VS Code's sidebar shows it. Fill in:

```
NEXT_PUBLIC_SUPABASE_URL=https://<your-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...
SUPABASE_SERVICE_ROLE_KEY=sb_secret_...
GEMINI_API_KEY=...
TRUSSED_API_KEY_OPENAI=...
TRUSSED_API_KEY_GEMINI=...
```

`.env.local` is gitignored. Never commit it, and never rename the secret key to
anything starting with `NEXT_PUBLIC_` — that ships it to the browser.

## 7. Preflight

```
npx tsx scripts/check.ts
```

Checks env vars, table existence, the `match_chunks` function, and a live
Gemini embedding call. Every failure prints its own fix.

## 8. Load the corpus

```
npx tsx scripts/ingest.ts --limit 5      # smoke test
npx tsx scripts/ingest.ts                # all 48 consumer sheets
npx tsx scripts/ingest.ts --lang es      # NIH Spanish sheets
```

Verify:

```sql
select fs.supplement, count(c.id) as chunks
from fact_sheets fs left join chunks c on c.fact_sheet_id = fs.id
group by fs.supplement order by chunks desc;
```

## 9. Run it

```
npm run dev
```

## Troubleshooting

**`fetch failed` / `UND_ERR_CONNECT_TIMEOUT` during ingest** — Cloudflare fronts
`ods.od.nih.gov` and refuses non-browser User-Agents; it also resolves to IPv6
first, which fails on networks without IPv6 routing. Both are handled in
`scripts/ingest.ts` (browser headers + `setDefaultResultOrder('ipv4first')`).

**`npm run ingest -- --limit 20` ignores the flag** — npm parses unknown
`--key value` pairs as its own config. Use `npx tsx scripts/ingest.ts` directly.

**`match_chunks` errors about vector dimensions** — the schema is `vector(768)`
for Gemini `text-embedding-004`. Changing embedding models means changing the
column type and re-ingesting.
