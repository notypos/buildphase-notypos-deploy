# ClearLabel — Project Plan

**Student:** Ike Machover · imachover2013@fau.edu · Z23283013
**Repository:** https://github.com/FAU-AI-HootCamp-Summer-2026/buildphase-notypos
**Companion document:** [`design.md`](design.md)

> **Status legend used throughout:** ✅ built and verified · 🔨 in progress · 📋 planned
>
> This is a living document. Sections marked ✅ describe code that exists and has
> been run; 📋 sections describe committed plans, not claims of completion.

---

## 1. Project Summary

### 1.1 Title

**ClearLabel** — plain-language answers about dietary supplements, grounded in NIH
Office of Dietary Supplements fact sheets.

### 1.2 Problem statement and sponsor

**Sponsor:** NIH Office of Dietary Supplements (ODS), via HeroX / NASA Tournament
Lab. Assigned through the FAU AI HootCamp as a **Lead Problem**.
**Mentorship:** Dr. David Jaramillo, LexisNexis Risk Solutions.

The sponsor's problem statement:

> Turn NIH dietary-supplement fact sheets into an engaging tool where users ask
> plain-language questions, scan product labels, and compare claims against NIH
> guidance with audience-specific explanations. Ship a deployed app that uses
> retrieval over the authoritative fact sheets to produce age-appropriate
> explanations separating evidence, uncertainty, and marketing claims, **without
> inventing medical content**.

The underlying gap: NIH ODS publishes rigorously reviewed fact sheets on 100+
supplements, in both consumer and health-professional versions. The consumer
versions draw substantially less engagement than the professional ones. Meanwhile
supplement decisions are made at the point of purchase, under the influence of
label marketing, by people who will never open a `.gov` fact sheet.

The information is not missing. It is unreachable at the moment of decision.

**Scope note.** The HeroX challenge itself is closed to new entrants — Phase 2 is
restricted to the eight Phase 1 winners announced in June 2026. ClearLabel is built
_against_ this problem statement as an academic project, not as a competition entry.

### 1.3 Target users and stakeholders

| Group                                           | Need                                             | How ClearLabel serves it                                                       |
| ----------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------ |
| **Adults** making everyday supplement decisions | Is this worth taking? Is this dose safe?         | Cited answers at an 8th–10th grade reading level                               |
| **Teens / young adults**                        | Encounter supplement claims through social media | Teen reading mode; Claim Check for viral claims                                |
| **Seniors**                                | Polypharmacy; narrower safety margins            | Senior mode foregrounds interactions and upper limits                     |
| **Caregivers**                                  | Managing someone else's regimen                  | Caregiver mode; Decision Card to bring to appointments                         |
| **Spanish-speaking users**                      | Health-equity gap in supplement literacy         | Answers retrieved from NIH's _own_ Spanish fact sheets, not machine-translated |
| **Clinicians** (indirect)                       | Patients arrive with unsourced beliefs           | Decision Card gives patients sourced questions to ask                          |

**Non-users, explicitly.** ClearLabel does not serve people seeking a diagnosis,
a personal dosing prescription, or advice about their own medications. Those
requests are redirected to a clinician by system-prompt policy.

### 1.4 Core value proposition

**Every claim is traceable to a named NIH section, and the system refuses rather
than speculates when the sources are silent.**

Most consumer supplement information is either marketing or an unsourced language
model. ClearLabel occupies neither position: answers are generated _only_ from
retrieved NIH passages, each answer carries citations to the specific fact sheet
and heading, and when retrieval falls below a measured similarity floor the system
returns a refusal **without calling the language model at all** — removing the code
path where an unanswerable question could be answered from model priors.

It matters because supplement misinformation causes real harm — nutrient toxicity
from stacked products, drug-nutrient interactions, and delayed care when a
supplement substitutes for treatment.

---

## 2. Requirements

### 2.1 Core requirements (Week 3 Gate)

| Gate requirement                                                                            | How ClearLabel addresses it                                                                                                                                                                                                                       | Status                 |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| **AI Integration** — meaningful AI feature, not a chatbot wrapper                           | RAG over 579 chunks of NIH content: query embedding → pgvector cosine search → similarity floor → grounded generation with enforced citations and a three-way evidence/uncertainty/marketing split. Plus a planned agentic multi-step stack scan. | ✅ core / 📋 agent     |
| ↳ error handling                                                                            | Typed `LlmError` with a `userMessage` field separating internal detail from what users see. Config errors surface immediately; transient ones retry.                                                                                              | ✅                     |
| ↳ loading states                                                                            | Skeleton placeholders during retrieval and generation; button disabled and relabeled.                                                                                                                                                             | ✅                     |
| ↳ rate-limit handling                                                                       | Two backoff ladders: 429 → 1/2/4 s, 5xx → 5/10/20 s. Embedding pacing at 8 chunks / 5 s with 15/45/70/70 s backoff (must exceed the 60 s quota window).                                                                                           | ✅                     |
| ↳ user-friendly messages                                                                    | "Too many questions in a row. Give it a minute." — never a stack trace or provider error.                                                                                                                                                         | ✅                     |
| **Backend & Database** — full CRUD, clean schema, persistence                               | Supabase Postgres, 10 tables, foreign keys with cascade deletes, HNSW vector index. Full CRUD on `stack_items`, `medications`, `conversations`.                                                                                                   | ✅ schema / 📋 CRUD UI |
| **Authentication** — registration, login, protected routes, sessions, env vars              | Supabase Auth (JWT). `profiles` auto-created by an `on_auth_user_created` trigger. Row-level security on every user-owned table. Browser and server clients built; login UI and middleware pending.                                               | 🔨                     |
| **Documentation** — README with name, Z-number, FAU email, links, setup, stack; design docs | [`README.md`](README.md), [`docs/SETUP.md`](docs/SETUP.md), this file, [`design.md`](design.md).                                                                                                                                                  | ✅ / 🔨 links          |
| **Deployment** — live, publicly accessible                                                  | Vercel. Production build verified locally (`next build` passes).                                                                                                                                                                                  | 📋                     |
| **GitHub repository** — clean code, meaningful commits on main                              | 7 scoped commits; no secrets tracked; `.gitignore` verified against `.env.local`.                                                                                                                                                                 | ✅                     |
| **Demo Video** — 3–5 min covering all features                                              | Scheduled Aug 25.                                                                                                                                                                                                                                 | 📋                     |
| **Canvas Submission** — repo URL                                                            | Intent slide submitted Aug 19. Final Aug 26.                                                                                                                                                                                                      | 🔨                     |

### 2.2 Build-phase requirements

#### 2.2.1 Problem selection and technical specification

**Domain research.** The corpus is the NIH ODS fact sheet library at
`ods.od.nih.gov/factsheets/list-all/` — U.S. government public domain, no license
barrier. Each sheet publishes in up to three variants sharing a URL stem:
`-Consumer`, `-HealthProfessional`, `-DatosEnEspanol`. Pages are consistently
structured: `<h2>` question-form section headings ("How much vitamin D do I need?"),
`<h3>` subsections under health-effects sections, and — critically — **tabular
Recommended Dietary Allowance and Tolerable Upper Intake Level data by life stage**.

That table structure is the single most important domain finding. It means dosage
safety thresholds can be parsed into typed database rows and compared arithmetically,
rather than asked of a language model that might recall them incorrectly.

**Stakeholders and constraints.**

| Constraint                                   | Consequence for the design                                                           |
| -------------------------------------------- | ------------------------------------------------------------------------------------ |
| Health information; wrong answers cause harm | Grounding is mandatory, refusal is a first-class outcome, no personal medical advice |
| Corpus is authoritative but fixed            | No user-generated content in the retrieval corpus, ever                              |
| Solo developer, 7-day build                  | MVP scope must be defensible; agentic features come after the core works             |
| Free-tier API quotas                         | Embedding throughput paced to ~100 chunks/min; caching planned for repeat queries    |
| Showcase demo on unknown venue Wi-Fi         | Pre-seeded demo account, cached responses, recorded video backup                     |
| Users may have low health literacy           | Reading-level adaptation is a core feature, not a nice-to-have                       |

**Challenges anticipated, and what actually happened.**

| Anticipated                         | Reality                                                                                                                                                                               |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scraping `.gov` HTML reliably       | Cloudflare fronts the domain and **403s non-browser User-Agents**; it also resolves IPv6-first, which times out on networks without IPv6 routing. Both solved in `scripts/ingest.ts`. |
| Chunking without destroying context | Solved by chunking _within_ `<h2>`/`<h3>` boundaries and prefixing each chunk with its heading.                                                                                       |
| Choosing a similarity threshold     | Solved by measuring rather than guessing — see §2.2.1 success metrics.                                                                                                                |
| Embedding provider availability     | FAU Trussed turned out to be **chat-only**; verified by probing `/embeddings`. Gemini is the sole embedding path.                                                                     |

**Technical feasibility study.** Every load-bearing assumption was validated before
committing to the architecture:

| Question                                                        | Method                            | Result                                          |
| --------------------------------------------------------------- | --------------------------------- | ----------------------------------------------- |
| Can the corpus be parsed structurally?                          | Ran the parser against live pages | 40 sheets → 579 chunks, section metadata intact |
| Can RDA/UL tables be extracted as numbers?                      | Parsed and inspected              | e.g. Vitamin C, ages 1–3: RDA 15 mg, UL 400 mg  |
| Does pgvector handle the corpus at this scale?                  | HNSW cosine index, live queries   | Sub-second retrieval at 579 chunks              |
| Can Trussed serve embeddings?                                   | Direct `/embeddings` probe        | **No** — chat models only                       |
| Does Trussed work from Vercel, not just campus?                 | Week 3 deployment                 | Yes                                             |
| Can a similarity floor actually separate in- from out-of-scope? | 10-question suite                 | Yes, with a 0.125 margin                        |

**Technology stack justification.** Full rationale in [`design.md`](design.md#technical-decisions).
Summary:

| Choice                            | Why                                                                                                         | Alternative rejected                                                            |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **Next.js 16 (App Router)**       | One deployable for UI and API; server components keep keys server-side                                      | Separate React SPA + FastAPI — two deploy targets, no benefit here              |
| **TypeScript**                    | The app is built on structured LLM output; one zod schema yields runtime validation _and_ the static type   | JavaScript — would require hand-written validation and give no types            |
| **Supabase**                      | Satisfies the backend gate _and_ supplies pgvector, so the vector store is one `JOIN` from application data | Pinecone/Chroma — a second service, and citations would need a cross-store join |
| **pgvector + HNSW**               | Corpus is ~600 chunks; a dedicated vector DB is unjustified at this scale                                   | Dedicated vector DB — operational cost with no measurable gain                  |
| **Gemini `gemini-embedding-001`** | Only available embedding provider; Matryoshka truncation to 768 dims keeps the index small                  | OpenAI embeddings — no key available; Trussed — chat-only                       |
| **Trussed `gpt-5.4`**             | Provided by FAU, verified working from Vercel, strong instruction-following for structured output           | Gemini for generation — kept as fallback                                        |
| **Vercel**                        | First-class Next.js target, free tier, preview deploys                                                      | Self-hosted — no benefit for a 7-day project                                    |

**System architecture, data flow, and user flow diagrams:** see
[`design.md`](design.md) §1–§3.

**Database schema and API structure:** see [`design.md`](design.md) §4–§5. Schema
is live in [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql).

**Weekly milestones, critical path, dependencies:** §3 below.

**Success metrics and KPIs.**

_Retrieval quality_ — measured, not asserted. `scripts/ask.ts --suite` runs ten
questions (six the NIH corpus covers, four it does not) against the live index:

| Group        | Similarity range |
| ------------ | ---------------- |
| In-scope     | 0.755 – 0.800    |
| Out-of-scope | 0.503 – 0.630    |

Clean separation with a 0.125 margin, so `RETRIEVAL_MIN_SIMILARITY = 0.66` sits above
every off-topic question and below every in-scope one. **This threshold is only valid
for the corpus it was measured against**; the suite is re-run after any change to
chunking or the embedding model.

| KPI                                                                    | Target                            | Current                                     |
| ---------------------------------------------------------------------- | --------------------------------- | ------------------------------------------- |
| Citation accuracy (cited chunk supports the claim), 40-item golden set | ≥ 95%                             | 📋 Aug 23                                   |
| Refusal rate on out-of-scope questions                                 | 100% below threshold              | ✅ 4/4                                      |
| False refusal rate on in-scope questions                               | 0%                                | ✅ 0/6                                      |
| Retrieval p95                                                          | < 400 ms                          | 🔨 instrumenting                            |
| End-to-end answer p95                                                  | < 5 s                             | 🔨                                          |
| Reading-level separation between audience modes                        | Measurable delta                  | ✅ qualitatively; 📋 Flesch-Kincaid scoring |
| Corpus coverage                                                        | 100% of published consumer sheets | ✅ 40/40                                    |

**MVP vs. nice-to-have.**

_MVP — required for the showcase:_

1. ✅ Cited Q&A over the ODS corpus with enforced grounding
2. ✅ Evidence / uncertainty / marketing card structure
3. ✅ Four audience reading modes
4. ✅ Measured refusal threshold
5. 🔨 Authentication with protected routes
6. 📋 My Stack CRUD + agentic upper-limit and interaction scan
7. 📋 Claim Check
8. 📋 Live deployment

_Nice-to-have — cut first under time pressure:_

- Label scan via the NIH DSLD API with vision OCR fallback
- Decision Card export
- Voice input (Web Speech API)
- Spanish corpus ingest (`--lang es`; pipeline supports it, corpus not yet loaded)
- Health-professional corpus variant

_Explicitly cut:_ gamification. High build cost, low payoff in a 10-minute demo,
and three of the eight Phase 1 concepts already occupy that space.

#### 2.2.2 Agentic AI and RAG

**Vector database selection.** Postgres + `pgvector`, inside the same Supabase
instance as application data. At ~600 chunks a dedicated vector service adds an
operational dependency and a network hop for no measurable retrieval benefit, and
it would split citations across two systems — the `fact_sheets` ↔ `chunks` join is
what makes a citation resolvable to a URL and a section heading.

Index: `hnsw (embedding vector_cosine_ops)`.

**Document ingestion and chunking strategy.** ✅ Implemented in
`scripts/ingest.ts` and `scripts/ods/parse.ts`.

1. **Discovery** — scrape the ODS index for real slugs rather than guessing them.
   Deduped case-insensitively (the index links both `chromium-` and `Chromium-`).
   A 31-slug hardcoded list is the fallback if the index is unreachable.
2. **Fetch** — browser headers (Cloudflare 403s bot agents), IPv4 forced, 20 s
   timeout, 3 retries with backoff, 400 ms politeness delay between sheets.
3. **Parse** — walk `<h2>`/`<h3>`/`<p>`/`<li>`, accumulating text under the current
   heading. Disclaimer and "where to find out more" sections are dropped.
4. **Chunk** — **never across a section boundary.** Sections under 1,200 characters
   stay whole; longer ones split on sentence boundaries with 150-character overlap so
   a dosage statement is never bisected. Every chunk is prefixed with its heading —
   strong retrieval signal, and it keeps an isolated chunk interpretable.
5. **Extract limits** — RDA and Upper Limit tables are parsed into typed
   `nutrient_limits` rows, merged per life stage.
6. **Embed and store** — batched, paced, normalized, written with the section
   metadata that citations depend on.

**Idempotency.** Each sheet is hashed. Unchanged sheets are skipped without
re-embedding. The hash is written **only after chunks land**, so a run that dies
mid-embed leaves the sheet marked incomplete and retries — rather than being marked
done forever with zero chunks. (This was a real bug, caught by the preflight showing
5 fact sheets and 0 chunks.)

**Embedding generation and storage.** Gemini `gemini-embedding-001`, truncated to
768 dimensions, stored as `vector(768)`.

Two non-obvious details that materially affect quality:

- **Asymmetric task types.** Documents embed as `RETRIEVAL_DOCUMENT`, queries as
  `RETRIEVAL_QUERY`. Using one type for both is a quiet recall loss that is very
  hard to spot by inspection.
- **Manual normalization.** `gemini-embedding-001` unit-normalizes only its full
  3072-dimension output. Truncated output arrives unnormalized, which makes cosine
  scores drift and any fixed threshold meaningless. `embeddings.ts` normalizes
  explicitly.

**Semantic search implementation.** ✅ The `match_chunks()` Postgres function ranks
by cosine distance with optional audience and language filters. The application
requests unfiltered ranked results and applies the similarity floor in TypeScript —
deliberately, so near-misses can be logged (`best was 0.412 — VitaminD-Consumer /
Can vitamin D be harmful?`). That log is how the threshold gets tuned instead of guessed.

**Agentic AI patterns.**

_Multi-step task design_ 📋 — the My Stack safety scan:

```
1. Load the user's stack, medications, and life stage
2. For each item: resolve the label name to a canonical supplement
3. Query nutrient_limits for that supplement + the user's life stage
4. Compare the user's dose to the UL           → upper-limit finding
5. Retrieve each supplement's "interactions" section  → interaction finding
6. If pregnant/postpartum, retrieve life-stage guidance → life-stage finding
7. Rank findings by severity, attach citations, persist to stack_scans
```

_Tool/function calling_ 📋 — the agent is given typed tools: `lookupNutrientLimits`,
`retrieveSection`, `resolveSupplementName`, `searchDSLD`. Numeric threshold
comparison happens **in application code, not in the model** — the model decides
_which_ limits to fetch and how to explain a finding; arithmetic against a
`nutrient_limits` row is deterministic.

_Agent memory and context retention_ 📋 — durable state in Postgres rather than a
conversation buffer: `stack_items`, `medications`, `profiles.life_stage`, and
`stack_scans` history so a scan can report what changed since last time.
`conversations`/`messages` retain chat context, with `messages.retrieved_chunk_ids`
recording exactly what retrieval returned for each turn — the audit trail that makes
a past citation verifiable.

_Orchestration logic_ 📋 — deterministic control flow in TypeScript with the model
called at specific decision points, rather than a free-running loop. For a safety
feature, an agent that can decide to skip the upper-limit check is a liability.

**How advanced AI features integrate, and how users interact with them.** The
retrieval layer is shared: Ask, Claim Check, and the stack scan all call
`retrieve()` and all render the same citation component. A user asks a question and
gets three cards plus sources; saves what they take and gets a flagged scan; pastes
a marketing claim and gets a verdict. Every surface leads back to the same NIH
sections.

**Caching and fallback strategies for failed retrievals.**

| Failure                           | Behavior                                               | Status |
| --------------------------------- | ------------------------------------------------------ | ------ |
| Retrieval below threshold         | Refuse; **do not call the model**                      | ✅     |
| Embedding API 429                 | Backoff exceeding the 60 s quota window                | ✅     |
| Generation 429 / 5xx              | Retry ladders; then a user-facing message              | ✅     |
| Generation returns malformed JSON | zod validation → one reprompt → typed error            | ✅     |
| Model provider fully down         | Fall back to the alternate provider                    | 📋     |
| Repeat question                   | Redis cache keyed on `(question, audience, language)`  | 📋     |
| Demo-day network failure          | Pre-seeded account + cached responses + recorded video | 📋     |

#### 2.2.3 Production engineering

📋 unless noted.

**Containerization.** A multi-stage `Dockerfile` (deps → build → runner on
`node:22-alpine`, non-root user, Next.js standalone output) plus a `docker-compose.yml`
running the app against a local Postgres with `pgvector` for offline development.
Vercel is the deploy target and does not require the image; the Dockerfile exists for
reproducibility and to keep the project portable.

**Observability.** Structured JSON logging with request IDs. Sentry for error
tracking, with `LlmError` grouped by `code` so provider outages are distinguishable
from schema failures. Already logging: per-call token usage (✅, from the Week 3
provider layer) and below-threshold retrieval near-misses (✅). Planned dashboard
metrics: retrieval latency p50/p95, answer latency, refusal rate, tokens per answer,
cache hit rate.

**Database optimization.** ✅ in place: HNSW index on embeddings; `btree` on
`chunks(fact_sheet_id)`, `stack_items(user_id)`, `messages(conversation_id, created_at)`,
`conversations(user_id, created_at desc)`. 📋: Supabase connection pooling for
serverless (pgBouncer transaction mode — Vercel functions otherwise exhaust
connections), daily automated backups, `pg_stat_statements` review before the demo.

**Caching.** Upstash Redis. Cache the full answer keyed on
`sha256(question + audience + language + corpusVersion)` with a 24 h TTL — AI calls
are the expensive operation, and demo questions repeat. Query embeddings cached for
1 h. Static assets via Vercel's CDN. Cache invalidates on corpus version bump so a
re-ingest cannot serve stale citations.

**Infrastructure documentation and reproducible deployment.** ✅
[`docs/SETUP.md`](docs/SETUP.md) covers provisioning end to end;
[`supabase/migrations/`](supabase/migrations/) is idempotent and re-runnable;
[`scripts/check.ts`](scripts/check.ts) verifies environment, tables, the
`match_chunks` RPC, and a live embedding call before anything else runs.

**Performance targets.**

| Target                | Approach                                                                                         | Status     |
| --------------------- | ------------------------------------------------------------------------------------------------ | ---------- |
| API p95 < 500 ms      | Applies to non-AI routes; AI routes are bounded by the provider and budgeted separately at < 5 s | 📋 measure |
| DB query p95 < 100 ms | HNSW at 579 chunks is well inside this                                                           | 🔨         |
| Uptime > 99.5%        | Vercel + Supabase managed SLAs                                                                   | 📋         |
| Error rate < 1%       | Sentry alerting                                                                                  | 📋         |

#### 2.2.4 Security and costs

**Secrets management.** ✅ All secrets are server-only environment variables;
nothing sensitive carries a `NEXT_PUBLIC_` prefix. `.env.local` is gitignored and
verified so — and `.gitignore` was corrected during the build because the `.env*`
pattern was also hiding `.env.example`, which _should_ be committed. `git ls-files`
confirms no `.env` file is tracked. 📋: Vercel environment variables per environment,
key rotation before the showcase, `gitleaks` in CI.

**Security hardening.**

| Control                                       | Status                                                                                                                                                                                                                                                                                 |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rate limiting                                 | ✅ in-memory, 10 req/min/IP → 📋 Redis-backed (per-instance memory resets on Vercel)                                                                                                                                                                                                   |
| Input validation                              | ✅ zod on every route boundary; length-bounded questions                                                                                                                                                                                                                               |
| Prompt-injection defense                      | ✅ partially — the corpus is trusted NIH content and users cannot add to it, which removes the main injection vector. User text is confined to a question field, never concatenated into the system prompt. 📋 output validation that citation indices reference real retrieved chunks |
| Row-level security                            | ✅ on all seven user-owned tables; `messages` inherits ownership through its conversation                                                                                                                                                                                              |
| CORS                                          | 📋 same-origin only                                                                                                                                                                                                                                                                    |
| HTTPS/SSL                                     | ✅ Vercel-enforced                                                                                                                                                                                                                                                                     |
| Security headers (CSP, HSTS, X-Frame-Options) | 📋 `next.config.ts`                                                                                                                                                                                                                                                                    |
| Service-role key isolation                    | ✅ server-only; used for corpus writes, never to read user rows unfiltered                                                                                                                                                                                                             |

**Cost optimization.** ✅ Token usage logged per call. 768-dimension truncation cuts
vector storage 4× against the default 3072. 📋: answer caching (the largest lever —
repeat questions cost nothing), request batching during ingest, budget alerts.

**Security audit plan.** 📋 for Aug 24: `npm audit` and Dependabot; `gitleaks` over
full history; manual review of every route for missing auth checks; verify RLS by
attempting cross-user reads with a second account; adversarial prompt testing
(instruction override, citation fabrication, medical-advice extraction). Findings
and fixes documented in `docs/security-audit.md`.

**Cost analysis.** Measured volumes from the running system, priced at published
Google rates (embedding $0.15/1M tokens; `gemini-2.5-flash` $0.30 in / $2.50 out).
Generation runs on FAU Trussed at no cost to the project, so the Gemini generation
figure is what it _would_ cost if the fallback carried production traffic.

_One-time corpus ingest:_ 579 chunks × ~300 tokens ≈ **174k tokens ≈ $0.03**.
Full re-ingest is required only when the embedding model changes.

_Per question:_ ~20 tokens (query embedding) + ~2,800 in / ~500 out (generation).

| Scale         | Questions/mo | Embeddings | Generation (if paid) | Supabase  | Vercel     | **Total** |
| ------------- | ------------ | ---------- | -------------------- | --------- | ---------- | --------- |
| Showcase demo | ~500         | <$0.01     | $1.05                | $0 (free) | $0 (hobby) | **~$1**   |
| Pilot         | 10,000       | $0.03      | $21                  | $0 (free) | $0         | **~$21**  |
| Departmental  | 100,000      | $0.30      | $210                 | $25 (Pro) | $20        | **~$255** |

**Today's actual cost: $0.** Gemini free tier, Trussed provided by FAU, Supabase
free tier, Vercel hobby. The dominant cost at any real scale is generation output
tokens — which is exactly what answer caching attacks, and why it is the first
optimization scheduled.

---

## 3. Timeline and Milestones

**Critical path:** corpus ingest → retrieval → grounded answers → **deployment** →
demo assets. Everything else can be cut. Deployment is deliberately early: a live
URL on Aug 21 means deployment surprises surface with five days of buffer instead of
on the night of the 26th.

### Completed — Aug 19 (overnight)

| Deliverable                                  | Status       |
| -------------------------------------------- | ------------ |
| Showcase intent one-pager → Canvas           | ✅ submitted |
| Repo scaffold, schema, RLS                   | ✅           |
| ODS ingest pipeline (40 sheets, 579 chunks)  | ✅           |
| Retrieval + grounded generation + `/api/ask` | ✅           |
| Threshold measured at 0.66                   | ✅           |
| Ask UI with audience modes and citations     | ✅           |
| 7 commits pushed to `main`                   | ✅           |

### Aug 20 — documentation and auth

- **Deliverables:** `plan.md`, `design.md` (clears the overdue Build Plan assignment);
  login/register UI; middleware-protected routes; **first Vercel deployment**.
- **Dependencies:** Vercel needs the Supabase and Gemini environment variables.
- **Risk:** Supabase Auth email confirmation can block local testing → disable
  confirmation in dev.

### Aug 21 — Claim Check and Spanish

- **Deliverables:** Claim Check with evidence-strength verdicts; Spanish corpus
  ingest (`--lang es`); Spanish answers verified end to end.
- **Dependencies:** Claim Check reuses `retrieve()` and `generateStructured()`.
- **Risk:** Spanish sheets may have a different HTML structure → dry-run parse first.

### Aug 22 — My Stack and the agent

- **Deliverables:** CRUD for stack items and medications; life stage on profile;
  agentic scan producing upper-limit and interaction findings.
- **Dependencies:** ⚠️ **`nutrient_limits` coverage is the critical dependency.**
  Botanicals and overview sheets have no RDA/UL tables, so the scan must degrade
  gracefully to interaction-only findings.
- **Risk:** highest-complexity item in the plan. If it slips, ship the CRUD and the
  interaction scan; defer upper-limit comparison.

### Aug 23 — evaluation and caching

- **Deliverables:** 40-question golden set with a scoring harness →
  `docs/evaluation.md`; Redis caching; Redis-backed rate limiting.
- **Buffer:** first genuine slack in the schedule; absorbs slippage from Aug 22.

### Aug 24 — hardening and stretch

- **Deliverables:** security audit; Sentry; security headers; CORS; `docs/costs.md`.
  If time allows: label scan (DSLD) and Decision Card.
- **Decision point:** stretch features are cut here without hesitation if anything
  earlier slipped.

### Aug 25 — demo assets

- **Deliverables:** 3–5 minute demo video with captions; 10–15 slide pitch deck with
  speaker notes; README artifact index complete.
- **Risk:** consistently underestimated. Video editing is allocated a full day.

### Aug 26 — buffer and submission

- **Deliverables:** final polish; all artifacts linked from README; **Canvas
  submission by 11:59 PM**.
- Deliberately reserved as buffer. Nothing new is started on this day.

### Aug 27 — rehearsal

- Full run-through on the backup path (recorded video, pre-seeded account, cached
  responses); prepared Q&A responses.

### Aug 28 — showcase

- 10-minute presentation, 5 minutes Q&A, 1:00–3:00 PM.

### Buffer and blocker summary

| Risk                                 | Likelihood | Mitigation                                                |
| ------------------------------------ | ---------- | --------------------------------------------------------- |
| Agent scan (Aug 22) overruns         | Medium     | Aug 23 buffer; ship CRUD + interactions only              |
| `nutrient_limits` coverage gaps      | Medium     | Graceful degradation; scan states what it could not check |
| Gemini free-tier quota during a demo | Low        | Answer caching; pre-seeded demo account                   |
| Venue network failure                | Medium     | Recorded video; cached responses; phone hotspot           |
| Deployment surprises                 | Low        | Deploying Aug 21, five days early                         |
| Demo assets underestimated           | High       | Full day allocated; Aug 26 held as buffer                 |
