# Showcase Q&A Prep

## Why use NIH fact sheets instead of a general chatbot?

General chatbots can answer from training data or unsupported assumptions.
ClearLabel retrieves NIH passages first, cites them, and refuses when retrieval
is below the measured relevance threshold.

## Does ClearLabel give medical advice?

No. It summarizes public NIH information and suggests clinician questions. It
does not diagnose, treat, prescribe, or tell a user to start or stop a product.

## Why is the stack checker deterministic?

Upper limits are numeric safety thresholds. ClearLabel sums doses and compares
them with parsed NIH rows in code so the model cannot skip, invent, or misread
the arithmetic.

## What personal data is stored?

Saved supplements, saved medication names, and saved Decision Cards are stored
for signed-in users under Supabase row-level security. Age, sex, and pregnancy
or breastfeeding status are session-only. Health conditions are not collected.

## What happens when NIH does not cover a question?

The app refuses before generation. The model is not called on that path, which
removes the chance that it fills the gap from prior knowledge.

## What is the most important limitation?

Spanish retrieval is designed but not fully shipped because the Spanish corpus
has not been ingested. The UI does not expose a broken language toggle.

## What would you build next?

The highest-value next steps are answer caching, production monitoring, a text
generation fallback provider, Spanish corpus ingestion, and a larger citation
evaluation set.

