# ClearLabel

Plain-language answers about dietary supplements, grounded in NIH Office of Dietary Supplements fact sheets.

**Student:** Ike Machover · imachover2013@fau.edu · Z23283013
**Sponsor:** NIH Office of Dietary Supplements, via HeroX / NASA Tournament Lab — Lead Problem, FAU AI HootCamp Summer 2026
**Mentorship:** Dr. David Jaramillo, LexisNexis Risk Solutions

## Artifacts

| Artifact                  | Link                                                                           |
| ------------------------- | ------------------------------------------------------------------------------ |
| Deployed application      | <https://buildphase-notypos.vercel.app>                                       |
| Demo video (3–5 min)      | _TODO_                                                                         |
| Pitch deck                | _TODO_                                                                         |
| One-page showcase summary | [`docs/ClearLabel_Showcase_Intent.pptx`](docs/ClearLabel_Showcase_Intent.pptx) |
| Project plan              | [`plan.md`](plan.md)                                                           |
| Technical design          | [`design.md`](design.md)                                                       |
| Database schema           | [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql), [`0002_privacy.sql`](supabase/migrations/0002_privacy.sql), [`0003_medications.sql`](supabase/migrations/0003_medications.sql) |
| Retrieval evaluation      | See [Retrieval quality](#retrieval-quality) below                             |
| Production health check   | [`/api/health`](https://buildphase-notypos.vercel.app/api/health) · [`/health`](https://buildphase-notypos.vercel.app/health) |

## The problem

NIH ODS publishes authoritative fact sheets on 100+ dietary supplements, but the
consumer versions draw far less engagement than the professional ones. People make
supplement decisions at the shelf, from label marketing, rather than from evidence.
ClearLabel puts that same NIH evidence behind a question box.

The retrieval pipeline is built to answer in Spanish from NIH's own
Spanish-language fact sheets rather than machine-translating the English ones —
but that corpus is not yet ingested, so Spanish isn't available yet. The UI
toggle was removed on Aug 25 rather than ship a control that silently failed.
See [Not yet built](#not-yet-built).

## Features

- **Ask** — conversational Q&A over the ODS corpus. Every answer cites its source
  fact sheet and section. Below a measured retrieval-similarity floor the app says
  NIH doesn't cover the question instead of answering anyway — the model is never
  called for a refusal.
- **Answer cards** — answers render as _What the evidence shows_ / _What's still
  uncertain_ / _What the marketing claims_, plus conditional sections when the
  retrieved fact sheet has relevant safety, interaction, or dosage content.
- **Reading level** — Simple or Standard. English only for now — the
  English/Spanish toggle was removed from the UI until the Spanish corpus is
  actually ingested (see [Not yet built](#not-yet-built)).
- **Session-only personalization** — age, sex, and pregnancy/breastfeeding status.
  Lives in `sessionStorage` only: never written to a database, never logged, never
  sent to an embedding call. Health **conditions** are deliberately never
  collected. **Medications** are the one exception (added Aug 26, for the
  interaction check below) — see [Privacy design](#privacy-design).
- **My Stack** — add and remove the supplements you take (typed, or scanned —
  see below). A deterministic checker computes per-nutrient totals across
  products against NIH upper limits and flags cumulative-dose and
  no-published-limit cases. A separate Medications tab lets you save medication
  names for the interaction check; health conditions are still never stored.
- **Label scanner** — photograph a Supplement Facts panel; a vision model
  transcribes it into structured doses that plug directly into My Stack. No
  sign-in required to scan — reading a photo touches no one's data — but saving
  the result requires an account. Tries three model candidates in order and
  falls through if one doesn't support images.
- **Barcode scanner** — scans live via the camera (`@zxing/browser`, entirely
  client-side) and resolves the code through a free UPC database to a product
  name, then looks that name up in NIH's own DSLD database and shows the
  manufacturer-submitted label as the source of truth — not a re-read of a
  photo. Falls back to the label scanner above when nothing matches.
- **Interaction check** — for each saved supplement, retrieves the NIH fact
  sheet and asks the model (constrained to only what's stated in the retrieved
  text) whether it names a saved medication or drug class in a
  caution/interaction context. Absence of a mention is reported as "not
  mentioned," never as "safe."
- **Saved Decision Cards** — printable summaries with suggested clinician questions;
  create, list, and delete, protected behind sign-in.
- **Production health check** — `/api/health` verifies every configured secret
  actually works against its real dependency (not just that it's present), without
  ever echoing a key or a raw provider error.

### Not yet built

- **Spanish retrieval** — the retrieval pipeline supports it, but the Spanish
  (`DatosEnEspanol`) NIH fact sheets were never run through
  `scripts/ingest.ts --lang es`. The language toggle was removed from the UI on
  Aug 25 rather than ship a control that would silently fail.
- **Live verification of the barcode lookup** — the barcode → UPC database →
  DSLD chain (below) is typechecked and lint-clean but hasn't been exercised
  against real network calls yet; the dev sandbox used to build it can't
  reach either external API.

## AI integration

| Concern                     | Approach                                                                                                                     |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Retrieval                   | Gemini `gemini-embedding-001`, truncated to 768 dims and unit-normalized, into Postgres `pgvector` with an HNSW cosine index |
| Query vs document embedding | `RETRIEVAL_QUERY` for queries, `RETRIEVAL_DOCUMENT` for chunks — embedding both the same way measurably hurts retrieval      |
| Generation                  | `gpt-5.4` via FAU Trussed — the only generation path currently wired into the live app (Google Gemini direct exists as a registered provider option in `src/lib/llm/models.ts` but isn't an automatic fallback yet) |
| Structured output           | zod schemas validated in `generateStructured()`, one reprompt on failure                                                     |
| Grounding                   | answers are generated only from retrieved chunks; chunk ids stored per message                                               |
| Refusal                     | below a measured cosine floor of 0.66 the app refuses and never calls the model                                              |
| Failure handling            | 429 → 1/2/4s backoff · 5xx → 5/10/20s backoff · wall-clock timeouts                                                          |
| Vision (label scan)         | Three model candidates tried in order (`gpt-5.4` → `gemini-2.5-pro` → `gemini-3.6-flash`) — Trussed's image support was unverified, so this discovers it at runtime |
| Second RAG feature          | `/api/interactions` retrieves each supplement's fact sheet + safety sections and asks the model to report only what's stated about a saved medication — never infers safety from silence |

Embeddings are Gemini-only — Trussed doesn't expose a working `/embeddings`
endpoint (verified: not on that key's model pool). Gemini's free tier trains on
submitted content, which is why health context is never sent to an embedding call.

## Privacy design

Decided deliberately after evaluating HIPAA applicability: HIPAA does not apply
(ClearLabel isn't a covered entity, and the sponsor's own guidelines call full
HIPAA compliance unnecessary here). What does apply — the FTC Health Breach
Notification Rule, and state laws like Washington's My Health My Data Act — cares
about retention and disclosure, so that's what the design targets:

| Data                                 | Where it lives                                  |
| ------------------------------------ | ------------------------------------------------ |
| Age, sex, pregnancy/breastfeeding    | `sessionStorage` only — never written, never logged |
| Health conditions                    | **Never collected at all**                       |
| Medications                          | Persisted (`medications`) — reintroduced Aug 26, scoped to the interaction check |
| Supplements (My Stack)               | Persisted                                         |
| Saved Decision Cards                 | Persisted                                         |

Conditions aren't collected because ODS discusses a limited set of them — most
fields would return "no specific guidance," a bad trade for a medical history.
Condition information instead comes from the retrieved fact sheet itself.

**Medications are the one deliberate exception.** Migration `0002_privacy.sql`
originally dropped the `medications` table outright, specifically so the
"never collected" claim was verifiable by reading the schema.
`0003_medications.sql` reverses that, narrowly, for the interaction check: the
table holds only a user-entered name, RLS-scoped to its owner, used by nothing
else in the app. Saved Decision Cards still redact medication names by default
(`decision_cards.includes_medications`) unless the user opts in when saving.

The system prompt enforces: *"Based on the information you provided, ODS
documents…"* — never *"based on your medical history, this is safe for you."*

## Tech stack

Next.js 16 (App Router) · TypeScript · Tailwind 4 · Supabase (Auth/JWT, Postgres,
pgvector, RLS) · Google Gemini (embeddings + vision fallback) · FAU Trussed
(generation + vision) · Vercel.

## Setup

```bash
npm install
cp .env.example .env.local     # fill in Supabase + Gemini + Trussed keys
```

Run `supabase/migrations/0001_init.sql`, then `0002_privacy.sql`, then
`0003_medications.sql` in the Supabase SQL editor. If `create extension vector`
errors, enable **Vector** under Database → Extensions first.

Load the corpus:

```bash
npx tsx scripts/ingest.ts --dry --limit 2   # inspect parsing, no DB writes
npx tsx scripts/ingest.ts --limit 20        # ingest 20 consumer sheets
npx tsx scripts/ingest.ts                   # full English consumer corpus
npx tsx scripts/ingest.ts --lang es         # NIH Spanish fact sheets
```

Call the script with `npx tsx` rather than `npm run ingest --`. npm parses
unrecognized `--flag value` pairs as its own config and strips them before the
script sees them, so `--limit 20` silently disappears.

Re-running is cheap: sheets whose content hash is unchanged are skipped without
re-embedding.

```bash
npm run dev
```

## Retrieval quality

`scripts/ask.ts --suite` runs ten questions — six the NIH sheets cover, four they
don't — against a live index and reports each one's similarity.

Measured on 579 chunks across 40 consumer fact sheets:

| Group                  | Similarity range |
| ---------------------- | ---------------- |
| In-scope questions     | 0.755 – 0.800    |
| Out-of-scope questions | 0.503 – 0.630    |

The groups separate cleanly, so `RETRIEVAL_MIN_SIMILARITY` is **0.66** — above every
off-topic question, below every in-scope one. The threshold is only valid for the
corpus it was measured against; re-run the suite after any change to chunking or the
embedding model.

```bash
npm run dev                                        # terminal 1
npx tsx scripts/ask.ts --suite                      # terminal 2
npx tsx scripts/ask.ts --base https://buildphase-notypos.vercel.app --suite
```

## Deterministic vs model

The model never decides a number. `src/lib/nih/`:

- `life-stage.ts` — parses scraped NIH labels ("Adults 51-70 years", "Pregnant
  teens") into comparable ranges, scores by specificity, returns the applicable
  row or `null`.
- `units.ts` — mg/mcg/g conversion; IU is nutrient-specific and returns `null` for
  unknown nutrients rather than guessing.
- `stack-check.ts` — per-nutrient totals across products, dose vs upper limit;
  flags cumulative-limit and no-published-limit cases explicitly.

## Testing

```bash
npx tsx scripts/test-units.ts           # unit conversion assertions
npx tsx scripts/test-life-stage.ts      # NIH row matching across ages/sexes/life stages
npx tsx scripts/test-context-prompt.ts  # what health context actually reaches the model
npx tsx scripts/ask.ts --suite          # retrieval threshold (needs npm run dev)
npx tsx scripts/check.ts                # preflight: env, tables, RPC, live embedding
```

## Data source

All content comes from the NIH Office of Dietary Supplements fact sheets at
<https://ods.od.nih.gov/factsheets/list-all/> (U.S. government public domain).

## Disclaimer

ClearLabel is a student project. It summarizes public NIH information and is not
medical advice. It does not diagnose, treat, or recommend. Talk to a clinician
before changing what you take.
