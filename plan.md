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
| **Adults** making everyday supplement decisions | Is this worth taking? Is this dose safe?         | Cited answers, Simple or Standard reading level                                |
| **Pregnant / breastfeeding people**             | NIH publishes distinct amounts for this group    | Session-only age/sex/pregnancy context steers which NIH row applies, without storing health data |
| **People managing a stack of supplements**      | Products fine individually can be unsafe combined | Deterministic per-nutrient cumulative-dose check against NIH upper limits (My Stack) |
| **People on prescription/OTC medications**      | Want to know if a supplement they take interacts with a medication | Saved medication list (My Stack → Medications tab) checked against NIH fact-sheet interaction language for each saved supplement — see §2.2.2 |
| **People holding a physical product**           | Reading a label and doing the math by hand is friction | Photograph a Supplement Facts panel; a vision model transcribes doses directly into My Stack — see §2.2.2 |
| **Spanish-speaking users**                      | Health-equity gap in supplement literacy         | **Not yet shipped.** Pipeline retrieves NIH's own Spanish fact sheets rather than machine-translating, but that corpus isn't ingested yet, and the UI toggle is currently hidden rather than left visibly broken — see §2.2.2. |
| **Clinicians** (indirect)                       | Patients arrive with unsourced beliefs           | Decision Card gives patients sourced questions to ask                          |

*(Original plan additionally scoped Teen/Senior/Caregiver reading modes and a
Claim Check feature for viral marketing claims. Both were cut during the build —
see "Explicitly cut" below — in favor of finishing the privacy-preserving
personalization and deterministic dose-checking that actually shipped.)*

**Also worth noting.** The privacy design in §2.2.2 originally dropped a
`medications` table specifically so "we don't collect medications" was
verifiable by reading the schema. That was reversed on Aug 26 for the
interaction-check feature above — deliberately and narrowly: only user-entered
medication *names* for that one feature, never health conditions, which are
still never collected. See §2.2.2 and `design.md` "Privacy design" for the
full reasoning.

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
| **AI Integration** — meaningful AI feature, not a chatbot wrapper                           | RAG over 579 chunks of NIH content: query embedding → pgvector cosine search → similarity floor → grounded generation with enforced citations and a three-way evidence/uncertainty/marketing split. The stack-safety check is deterministic TypeScript, not an agent — see §2.2.2 for why that's a deliberate choice. Two more AI features shipped Aug 26: a vision-based label scanner (photo → structured doses) and a grounded supplement × medication interaction check — both in §2.2.2. | ✅     |
| ↳ error handling                                                                            | Typed `LlmError` with a `userMessage` field separating internal detail from what users see. Config errors surface immediately; transient ones retry.                                                                                              | ✅                     |
| ↳ loading states                                                                            | Skeleton placeholders during retrieval and generation; button disabled and relabeled.                                                                                                                                                             | ✅                     |
| ↳ rate-limit handling                                                                       | Two backoff ladders: 429 → 1/2/4 s, 5xx → 5/10/20 s. Embedding pacing at 8 chunks / 5 s with 15/45/70/70 s backoff (must exceed the 60 s quota window).                                                                                           | ✅                     |
| ↳ user-friendly messages                                                                    | "Too many questions in a row. Give it a minute." — never a stack trace or provider error.                                                                                                                                                         | ✅                     |
| **Backend & Database** — full CRUD, clean schema, persistence                               | Supabase Postgres, RLS on every user-owned table, HNSW vector index. Full CRUD on `decision_cards` (create/list/delete). `stack_items`: full create/list/delete. `medications`/`stack_scans` were dropped outright by `0002_privacy.sql` — see privacy design. `conversations`/`messages`/`claim_checks` remain in the schema from the original plan but are unused by any current route; candidates for a future cleanup migration. | ✅               |
| **Authentication** — registration, login, protected routes, sessions, env vars              | Supabase Auth (JWT). `profiles` auto-created by an `on_auth_user_created` trigger. Row-level security on every user-owned table. `src/middleware.ts` protects `/stack` and `/cards`.                                               | ✅                     |
| **Documentation** — README with name, Z-number, FAU email, links, setup, stack; design docs | [`README.md`](README.md), [`docs/SETUP.md`](docs/SETUP.md), this file, [`design.md`](design.md).                                                                                                                                                  | ✅                     |
| **Deployment** — live, publicly accessible                                                  | Vercel, live at <https://buildphase-notypos.vercel.app>. `/api/health` verifies every configured secret against its real dependency in production.                                                                                            | ✅                     |
| **GitHub repository** — clean code, meaningful commits on main                              | Clean, scoped commit history on `main` — each commit is a single feature or fix (see `git log --oneline`); no secrets tracked; `.gitignore` verified against `.env.local`.                                                                                                                                                                 | ✅                     |
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
| Reading-level separation (Simple vs. Standard)                          | Measurable delta                  | ✅ qualitatively; 📋 Flesch-Kincaid scoring |
| Corpus coverage                                                        | 100% of published consumer sheets | ✅ 40/40                                    |

**MVP vs. nice-to-have.**

_MVP — required for the showcase:_

1. ✅ Cited Q&A over the ODS corpus with enforced grounding
2. ✅ Evidence / uncertainty / marketing card structure
3. ✅ Reading level (Simple/Standard). English only — the EN/ES toggle was removed from the UI on Aug 25 (`src/app/page.tsx` locks `language` to `'en'`) rather than ship a control that silently failed; see §2.2.2.
4. ✅ Measured refusal threshold
5. ✅ Authentication with protected routes
6. ✅ My Stack: view + add + remove + deterministic upper-limit/interaction check
7. ✅ Live deployment — <https://buildphase-notypos.vercel.app>

_Nice-to-have — cut first under time pressure:_

- ✅ Label scan — shipped Aug 26 as vision-model OCR (`src/app/scan`,
  `src/lib/vision/scan-label.ts`): a photo is transcribed directly into structured
  doses.
- ✅ Photo → NIH source-of-truth lookup — `src/lib/vision/identify-product.ts`
  + `src/lib/dsld/client.ts` + `/api/scan-product`. A photo of the front of
  the bottle (brand + product name, not the ingredients panel) goes through
  the same vision-model chain the Supplement Facts scanner uses, returning
  just a brand/product name; that name is then searched against NIH's DSLD
  API to pull the manufacturer-submitted label as the source of truth — not
  a re-read of a photo. Falls back to the vision-OCR scanner above when
  nothing matches, so it never dead-ends the way a database-only lookup
  would.
- 🔨 **Not yet live-verified against DSLD** — the vision-identification half
  is proven (same infrastructure as the working Supplement Facts scanner);
  the DSLD search-and-fetch half is typechecked against DSLD's real response
  shapes but this sandbox's network egress blocks api.ods.od.nih.gov, so it
  wants one real test run with normal internet access before the Friday demo.
- ✅ Auto-capture, added after real-device feedback — the camera snaps on its
  own once the frame stops moving for ~1s (frame-diff stillness check, not
  symbol decoding), then falls back to a mandatory manual Capture button
  after two auto-attempts find no match, so it can't loop forever guessing.
- ✅ Fixed a real correctness bug: dose-safety checks were reporting "NIH has
  no limit" for nutrients NIH does track, because a label's (or the vision
  model's) wording didn't match NIH's own fact-sheet spelling — "Thiamine"
  vs NIH's "Thiamin", "Folic Acid" vs NIH's "Folate", and similar B-vitamin
  chemical-form names. `canonicalNutrient()` now maps ~20 known alternate
  names to their NIH fact-sheet term before matching; regression tests for
  the exact reported cases live in `scripts/test-units.ts`.
- ✅ Supplement × medication interaction check — shipped Aug 26
  (`src/lib/rag/interactions.ts`, `/api/interactions`). Required reintroducing a
  `medications` table (migration `0003`, reversing part of the Aug privacy
  redesign) — see §2.2.2 and the note in §1.3.
- ✅ Decision Card export — shipped (create/list/delete, clinician questions, print)
- Voice input (Web Speech API)
- Spanish corpus ingest (`--lang es`; pipeline supports it, corpus not yet loaded —
  the toggle was removed from the UI on Aug 25 rather than left visibly returning a
  refusal for every question)
- Health-professional corpus variant

_Explicitly cut:_ gamification (high build cost, low payoff in a 10-minute demo,
and three of the eight Phase 1 concepts already occupy that space); **Claim Check**
(paste-a-claim verdict feature — dropped in favor of finishing the privacy-preserving
personalization and dose-checking that shipped instead); **agentic multi-step
orchestration** for the stack scan (kept deterministic instead — the reasoning in
§2.2.2 held: an agent that can decide to skip the upper-limit check is a liability
in a safety feature, so it was never worth building even as a stretch goal) **Live
barcode scanning** (native `BarcodeDetector` + `@zxing/browser`, built and
typechecked Aug 26 morning — cut that same day after testing on the actual
demo hardware/browser showed it unreliable in practice, not just a
theoretical browser-support gap. Replaced with photographing the front label
and letting the existing vision model identify the product instead, see
§2.2.2).

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

**Two more model-backed features, added Aug 26.**

_Label scanner_ (`src/lib/vision/scan-label.ts`, `/api/scan`) — a photographed
Supplement Facts panel is sent to a vision-capable model with a schema forcing
`{productName, items[], readable, note}`; the model transcribes only what's
printed, never judges whether a dose is safe. It tries three model candidates in
order (`trussed-openai/gpt-5.4` → `trussed-gemini/gemini-2.5-pro` →
`google/gemini-3.6-flash`) and falls through on failure — Trussed vision support
was unverified going in, so the fallback exists because the first candidate
might simply not support images server-side, not as a resilience nicety. The
route itself requires no sign-in (reading a photo touches no one's data,
nothing is stored); saving the scanned items to My Stack still requires an
account, enforced by Supabase RLS on the actual write. Results are tagged
against `nutrient_limits` so the UI can flag, at scan time, which rows the
dose-safety check will actually be able to use.

_Interaction check_ (`src/lib/rag/interactions.ts`, `/api/interactions`) — the
second consumer of the retrieval layer besides Ask. For each saved supplement it
retrieves the fact sheet plus its safety sections (the same
`retrieveSafetySections()` Ask uses) and asks the model, constrained to a zod
schema, whether the excerpts name a given saved medication or its drug class in
an interaction/caution context. The system prompt is explicit that "not
mentioned" must never be reported as "safe" — absence of a mention is not
evidence of safety. This is the one place the model reasons over free text
instead of a lookup table, because a drug interaction is a claim in prose, not a
number in an NIH table the way an upper limit is.

Building the interaction check required a real, informed reversal:
`0002_privacy.sql` had dropped the `medications` table specifically so "we don't
collect medications" was verifiable by reading the schema. `0003_medications.sql`
recreates it, scoped narrowly — RLS-protected, holding only user-entered names,
used only for this feature. Health **conditions** are still never collected
anywhere in the app. See `design.md` "Privacy design" for the updated table.

**Multi-step orchestration — deliberately not agentic.**

The original plan called this section "Agentic AI patterns": an LLM agent with
typed tools (`lookupNutrientLimits`, `retrieveSection`, `resolveSupplementName`,
`searchDSLD`) deciding which checks to run and in what order. That was never built
— not because it ran out of time, but because the reasoning against it held up:
**for a safety feature, an agent that can decide to skip the upper-limit check is a
liability.** What shipped instead is fixed, deterministic control flow in
`src/lib/nih/stack-check.ts`:

```
1. Load the user's saved stack items
2. For each item: look up nutrient_limits for that supplement + the applicable NIH life-stage row
3. Sum dose per nutrient across every product in the stack
4. Compare the summed dose to the Tolerable Upper Intake Level  -> cumulative_upper_limit finding
5. Where NIH publishes no UL for a nutrient, say so explicitly    -> no_limit_published finding
6. Attach citations; nothing here calls the model
```

The model's role is narrower than originally scoped, and that's the point: it
explains a finding in plain language and writes 100% of the user-visible answer
text elsewhere in the app, but it never decides a dose, never decides which limit
applies, and never decides whether to run a check. Two real bugs surfaced by
`scripts/test-life-stage.ts` justify this in retrospect — month ranges padded as
years (an infant's limit reaching a toddler), and age-less "Pregnant teens" rows
matching a 30-year-old. Both would have produced a wrong safety answer silently if
an agent, rather than a typed comparison with its own test suite, had been making
the call.

State is durable in Postgres rather than a conversation buffer — `stack_items` and
saved `decision_cards` persist; the session-only `HealthContext` (age, sex,
pregnancy/breastfeeding) deliberately does not, per the privacy design in
`design.md`. Conditions and medications were removed from the schema entirely in
`0002_privacy.sql` rather than merely left unused — see "Explicitly cut" above.

**How the AI features integrate, and how users interact with them.** The
retrieval layer is shared: Ask and the My Stack safety check both resolve back to
the same NIH fact sheets and the same citation format. A user asks a question and
gets three evidence/uncertainty/marketing cards plus sources; saves what they take
and gets a deterministic dose check. Every surface leads back to the same NIH
sections.

**Caching and fallback strategies for failed retrievals.**

| Failure                           | Behavior                                               | Status |
| --------------------------------- | ------------------------------------------------------ | ------ |
| Retrieval below threshold         | Refuse; **do not call the model**                      | ✅     |
| Embedding API 429                 | Backoff exceeding the 60 s quota window                | ✅     |
| Generation 429 / 5xx              | Retry ladders; then a user-facing message              | ✅     |
| Generation returns malformed JSON | zod validation → one reprompt → typed error            | ✅     |
| Model provider fully down (text)  | Fall back to the alternate provider                    | 📋     |
| Vision model rejects the image    | Try the next candidate (Trussed → Trussed-Gemini → Google), then a user-facing message | ✅     |
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
| Row-level security                            | ✅ on every user-owned table, including `medications` reintroduced in `0003_medications.sql`; `messages` inherits ownership through its conversation                                                                                                                                                                                              |
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
**Note:** that figure prices the now-retired `gemini-2.5-flash`; Google's
replacement `gemini-3.6-flash` has different published rates that haven't been
re-checked here — treat this column as illustrative, not current, until
someone looks up the new price.

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

**Critical path:** corpus ingest → retrieval → grounded answers → deployment →
demo assets. The original plan targeted deployment by Aug 21, five days of buffer
before the Aug 26 deadline. That buffer did not survive contact with reality —
deployment slipped and became its own multi-day effort, documented below.

### Completed — Aug 19 (overnight)

| Deliverable                                  | Status       |
| --------------------------------------------- | ------------ |
| Showcase intent one-pager → Canvas           | ✅ submitted |
| Repo scaffold, schema, RLS                   | ✅           |
| ODS ingest pipeline (40 sheets, 579 chunks)  | ✅           |
| Retrieval + grounded generation + `/api/ask` | ✅           |
| Threshold measured at 0.66                   | ✅           |
| Ask UI with audience modes and citations     | ✅ (later simplified — see §1.3) |
| 7 commits pushed to `main`                   | ✅           |

### Aug 20–24 — what actually shipped, against what was planned

The original day-by-day plan (documentation and auth on Aug 20, Claim Check and
Spanish on Aug 21, My Stack and an agentic scan on Aug 22, evaluation and caching
on Aug 23, hardening and stretch goals on Aug 24) did not survive intact. What
actually happened across those five days, in summary:

| Planned                                    | What shipped instead                                                                   |
| ------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Auth + first Vercel deployment (Aug 20)     | Auth shipped. Deployment did not go live until Aug 25 — see "Deployment, honestly" below. |
| Claim Check + Spanish ingest (Aug 21)       | Claim Check cut entirely (see "Explicitly cut", §2.2). Spanish ingest never run — the toggle exists in the UI but returns a refusal for every question; fixing this is in progress. |
| My Stack CRUD + agentic scan (Aug 22)       | My Stack view + a **deterministic** cumulative-dose check shipped instead of an agent — see §2.2.2 for why that was a considered decision, not a shortfall. Add-item form still in progress. |
| Evaluation harness + Redis caching (Aug 23) | Not built. No golden-set scoring harness, no caching layer.                             |
| Security audit + Sentry + CORS (Aug 24)     | Not built. Rate limiting and RLS shipped (§2.2.4); the rest of the hardening list is unstarted. |

Instead, the week's real engineering effort went into a privacy redesign that
wasn't in the original plan at all: `0002_privacy.sql` dropped `medications` and
`stack_scans` outright and removed session health context from persistence
entirely, after evaluating HIPAA and state health-privacy law applicability (see
"Privacy design" in [`design.md`](design.md)). That wasn't scoped on Aug 19 — it
came from thinking harder about the problem mid-build, and it's the project's
actual differentiator, not the originally-planned Claim Check or agent.

**Deployment, honestly.** Getting a live URL took far longer than the Aug 20–21
target. In rough order: environment variables set with the wrong Vercel
"Sensitive" designation for `NEXT_PUBLIC_` values; a Trussed API key transposed
between the OpenAI-compatible and Gemini-compatible key slots, producing a 401
that only reproduced in production, not locally; a Vercel deployment stuck
building from a stale commit because the `fork` git remote used for deployment
(separate from the graded Classroom repo, since org admin approval for the
Vercel GitHub App wasn't available) had silently gone missing from the local
clone; GitHub's fork-visibility restriction blocking an attempt to make that fork
public; and finally Vercel's Hobby-plan single-collaborator deployment gate
blocking builds because the commit author's GitHub identity didn't match the
account that owns the Vercel project. Live as of Aug 25 at
<https://buildphase-notypos.vercel.app>, verified end-to-end via `/api/health?deep=1`.

### Aug 25 — today

- Deployment finally verified working end to end.
- Pregnancy/breastfeeding checkbox eligibility bug fixed (was requiring an age
  before showing, rather than showing as soon as sex=female — see `src/lib/health-context.ts`).
- `README.md` and this file brought current with what's actually built.
- `design.md` brought current; My Stack add/remove form shipped.
- Remaining: demo video and pitch deck.

### Aug 26 — submission

- Shipped, uncommitted until today: label scanner (vision OCR), supplement ×
  medication interaction check, `medications` table reintroduced
  (`0003_medications.sql`, narrowly scoped — see §2.2.2), My Stack reorganized
  into Supplements/Medications tabs. `/scan` is deliberately public (reading a
  photo touches no data); the routes that actually write data
  (`/api/interactions`, `/api/stack-check`) require sign-in.
- `plan.md`, `design.md`, `README.md` audited line-by-line against the actual
  repo (git log, migrations, middleware, source) and corrected — including the
  Spanish toggle, which was already hidden from the UI on Aug 25 but the docs
  still described as visible, and a stale "7 commits" count.
- **Deliverables:** final polish; all artifacts linked from README; **Canvas
  submission by 11:59 PM.**
- No buffer day remains — Aug 26 is deadline day, not a reserve.

### Aug 27

- Rehearsal for the showcase: full run-through, prepared Q&A responses. A
  pre-seeded demo account and a recorded-video fallback for venue network
  failure were planned but not built — worth a quick decision on whether they're
  still worth doing given the compressed remaining time.

### Aug 28 — showcase

- 10-minute presentation, 5 minutes Q&A, 1:00–3:00 PM.

### Risks remaining

| Risk                                       | Likelihood | Mitigation                                                          |
| ------------------------------------------- | ---------- | ---------------------------------------------------------------------- |
| No demo-day network fallback                | Medium     | Not yet built; consider a cached-response or recorded-video backup   |
| Spanish toggle still broken if not fixed    | Medium     | Documented honestly either way (§1.3, §2.2.2); hide the toggle if the ingest doesn't land in time |
| Demo video / pitch deck time                | High       | Consistently the most underestimated item across every version of this plan |
| Scanner/interaction check are brand-new, un-rehearsed | Medium | Built and typechecked Aug 26 but not yet run through a full demo rehearsal — worth a manual pass before Aug 28 |
