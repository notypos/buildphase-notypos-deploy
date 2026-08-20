# ClearLabel

Plain-language answers about dietary supplements, grounded in NIH Office of Dietary Supplements fact sheets.

**Student:** _TODO: full name_ · _TODO: FAU email_ · _TODO: Z-number_
**Sponsor:** NIH Office of Dietary Supplements, via HeroX / NASA Tournament Lab — Lead Problem, FAU AI HootCamp Summer 2026
**Mentorship:** Dr. David Jaramillo, LexisNexis Risk Solutions

## Artifacts

| Artifact | Link |
|---|---|
| Deployed application | _TODO_ |
| Demo video (3–5 min) | _TODO_ |
| Pitch deck | _TODO_ |
| One-page showcase summary | [`docs/ClearLabel_Showcase_Intent.pptx`](docs/ClearLabel_Showcase_Intent.pptx) |
| Project plan | [`plan.md`](plan.md) |
| Technical design | [`design.md`](design.md) |
| Database schema | [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) |
| Retrieval evaluation | _TODO: `docs/evaluation.md`_ |
| Cost analysis | _TODO: `docs/costs.md`_ |

## The problem

NIH ODS publishes authoritative fact sheets on 100+ dietary supplements, but the
consumer versions draw far less engagement than the professional ones. People make
supplement decisions at the shelf, from label marketing, rather than from evidence.
ClearLabel puts that same NIH evidence behind a question box and a phone camera.

**Who it serves:** consumers making supplement decisions — teens, adults, older
adults, and caregivers. Spanish answers retrieve NIH's own Spanish-language fact
sheets rather than machine-translating the English ones.

## Features

- **Ask** — conversational Q&A over the ODS corpus. Every answer cites its source
  fact sheet and section. Below a retrieval-similarity floor the app says NIH doesn't
  cover the question instead of answering anyway.
- **Evidence cards** — answers render as *What the evidence shows* / *What's still
  uncertain* / *What the marketing claims*.
- **Audience modes** — Teen · Adult · Older Adult · Caregiver, plus Spanish.
- **Claim Check** — paste a marketing claim, get an evidence-strength verdict with citations.
- **My Stack** — save what you take, plus medications and life stage. An agent runs a
  multi-step scan for upper-limit and interaction flags.
- **Label scan** — barcode/product lookup against the NIH Dietary Supplement Label
  Database (DSLD), with vision-model OCR of the Supplement Facts panel as fallback.
- **Decision Card** — printable summary with questions for your clinician.

## AI integration

| Concern | Approach |
|---|---|
| Retrieval | Gemini `text-embedding-004` (768-dim) into Postgres `pgvector`, HNSW cosine index |
| Query vs document embedding | `RETRIEVAL_QUERY` for queries, `RETRIEVAL_DOCUMENT` for chunks |
| Generation | `gpt-5.4` via FAU Trussed (default); Gemini direct as fallback |
| Structured output | zod schemas validated in `generateStructured()`, one reprompt on failure |
| Grounding | answers are generated only from retrieved chunks; chunk ids stored per message |
| Failure handling | 429 → 1/2/4s backoff · 5xx → 5/10/20s backoff · wall-clock timeouts |

## Tech stack

Next.js 16 (App Router) · TypeScript · Tailwind 4 · Supabase (Auth/JWT, Postgres,
pgvector, RLS) · Google Gemini (embeddings, vision) · FAU Trussed (generation) ·
Vercel.

## Setup

```bash
npm install
cp .env.example .env.local     # fill in Supabase + Gemini + Trussed keys
```

Run `supabase/migrations/0001_init.sql` in the Supabase SQL editor. If
`create extension vector` errors, enable **Vector** under Database → Extensions first.

Load the corpus:

```bash
npx tsx scripts/ingest.ts --dry --limit 2   # inspect parsing, no DB writes
npx tsx scripts/ingest.ts --limit 20        # ingest 20 consumer sheets
npx tsx scripts/ingest.ts                   # full English consumer corpus
npx tsx scripts/ingest.ts --lang es         # NIH Spanish fact sheets
npx tsx scripts/ingest.ts --audience health_professional
```

Call the script with `npx tsx` rather than `npm run ingest --`. npm parses
unrecognized `--flag value` pairs as its own config and strips them before the
script sees them, so `--limit 20` silently disappears.

Re-running is cheap: sheets whose content hash is unchanged are skipped without
re-embedding.

```bash
npm run dev
```

## Data source

All content comes from the NIH Office of Dietary Supplements fact sheets at
<https://ods.od.nih.gov/factsheets/list-all/> (U.S. government public domain).
Product label data comes from the NIH Dietary Supplement Label Database,
<https://dsld.od.nih.gov>.

## Disclaimer

ClearLabel is a student project. It summarizes public NIH information and is not
medical advice. It does not diagnose, treat, or recommend. Talk to a clinician
before changing what you take.
