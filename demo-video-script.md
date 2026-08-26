# ClearLabel — Demo Video Script

**Target: 4:00–4:30 total (hard ceiling 5:00).** Timestamps are cumulative — if
you're running long by the 2:30 mark, cut the interaction-check beat (marked
optional below) rather than rushing the ending.

Screen recording + voiceover. Record screen first at a relaxed pace, write
narration to match afterward if it's easier than talking live.

---

### 0:00–0:20 — Hook

**Screen:** Land on the homepage / Ask screen, nothing typed yet.

**Say:**
> Supplement labels are confusing, and most advice online is either
> marketing copy from the brand selling it, or a chatbot that'll happily
> make something up. ClearLabel is a RAG assistant that only answers from
> NIH's own Office of Dietary Supplements fact sheets — and it tells you
> when NIH hasn't covered your question at all, instead of guessing.

---

### 0:20–1:10 — Ask, with citations and a real refusal

**Screen:** Type a real question — *"Can too much vitamin D be harmful?"* —
and let the answer render. Scroll to show the citation markers and the
Evidence / Uncertainty / Marketing sections.

**Say:**
> Every answer is grounded in retrieved NIH text, cited by section — you
> can see exactly which fact sheet backed each claim. It also splits
> out what's established evidence versus what's marketing framing you
> might see on a label.

**Screen:** Type an off-topic question — *"What's the best pre-workout
brand to buy?"* — and show the refusal.

**Say:**
> And when a question falls outside what NIH covers, it says so, instead
> of answering from the model's own general knowledge. That refusal is
> enforced by a similarity floor on retrieval — not a prompt asking the
> model to behave.

---

### 1:10–2:00 — Scan a product, and the safety net when a match is wrong

**Screen:** Open the product scanner, photograph a real bottle's front
label (brand + product name visible). Let it identify and pull the DSLD
match.

**Say:**
> You can also just photograph the bottle. It identifies the brand and
> product, then pulls the manufacturer-submitted label straight from
> NIH's Dietary Supplement Label Database — not what's read off the photo,
> the actual filing NIH has on record.

**Screen:** If you have a same-brand product with variants (e.g., a
"plain" and a "with Vitamin C" version of the same line), scan the plain
one and show the "not the right one?" alternates panel.

**Say:**
> Same-brand products sometimes have near-identical names with different
> ingredients — a plain formula versus a "with Vitamin C" variant, for
> example. If the match looks off, alternates are one tap away instead of
> silently trusting a wrong label.

*(If you don't have a multi-variant product on hand, cut this second
screen and just narrate the first scan — the DSLD-sourcing point still
lands.)*

---

### 2:00–2:35 — Dose safety, deterministically

**Screen:** Scan or manually enter a Supplement Facts panel; show the
per-nutrient upper-limit check flagging something (or showing green when
it's fine). If you have two products that are each fine alone but
combine over the limit, show the cumulative-dose flag — that's the
strongest visual.

**Say:**
> Dose safety isn't left to the model either. Upper limits, unit
> conversion, and life-stage matching — age, sex, pregnancy — are all
> deterministic lookups against NIH's own tables. It'll also catch a
> cumulative overage: two products that are each fine on their own, but
> add up to too much together.

---

### 2:35–3:05 — Interaction check *(optional — cut first if short on time)*

**Screen:** Add a medication name, show the interaction check surfacing
the relevant "does X interact with medications" section from a saved
supplement's fact sheet.

**Say:**
> If you've saved a medication, it checks your supplements against the
> interaction sections of their own fact sheets — pulled directly from
> NIH, not inferred by the model.

---

### 3:05–3:40 — Privacy, briefly

**Screen:** Health-context panel (age/sex/pregnancy fields) — point at it,
no need to fill it in on screen.

**Say:**
> On privacy: health conditions are never collected, full stop. Age, sex,
> and pregnancy status live in your browser session only — never written
> to a database, never logged. The only things persisted are supplements,
> medications you choose to save, and your own saved decision cards — all
> access-controlled to your account.

---

### 3:40–4:15 — Close

**Screen:** Back to a saved Decision Card, or the homepage.

**Say:**
> Every answer here traces back to something NIH actually published —
> grounded, cited, and honest about what it doesn't know. That's
> ClearLabel.

---

## Before you hit record

- Pick 1–2 real supplement bottles you can hold up to the camera — ideally
  one with a same-brand variant on a shelf or in a search result, for the
  alternates beat.
- Have the off-topic refusal question ready to type quickly (pre-workout
  brand question above, or your own) — don't improvise an off-topic
  question live, some phrasings can accidentally cross the similarity
  floor and answer when you want a clean refusal.
- Don't ad-lib an MRI-related question on camera — that's a known
  retrieval edge case (tracked in the project notes) where phrasing
  affects whether it answers or refuses. Stick to the scripted examples.
- Test the full recording path once end-to-end before the real take —
  scanner camera permissions in particular are worth confirming work on
  whatever device you're recording from.
- If you're cutting for time, cut in this order: interaction check first,
  then the second (alternates) scan screen, then trim the close. Keep
  Ask + refusal + one product scan no matter what — those three carry the
  positioning.
