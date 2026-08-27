# Security, Testing, and Cost Notes

## Security

- Secrets are stored in environment variables and are not committed.
- Public browser variables use the `NEXT_PUBLIC_` prefix only when they are
  intended to be visible in the client bundle.
- Supabase row-level security protects user-owned tables.
- Health context for age, sex, and pregnancy/breastfeeding is session-only in
  the browser UI.
- Health conditions are not collected.
- Medication names are stored only for the interaction-check feature.
- Route inputs are validated with zod at server boundaries.
- Retrieval refuses out-of-scope questions below the measured similarity floor.
- `/api/health` checks production configuration without echoing secrets.

## Testing

Core checks:

```bash
npm run typecheck
npm run lint
npm run build
```

Project-specific checks:

```bash
npx tsx scripts/test-units.ts
npx tsx scripts/test-dsld-match.ts
npx tsx scripts/test-life-stage.ts
npx tsx scripts/test-context-prompt.ts
npx tsx scripts/check.ts
npx tsx scripts/ask.ts --suite
```

Manual demo checks:

- Ask an NIH-covered question and confirm citations render.
- Ask an out-of-scope question and confirm refusal.
- Scan a Supplement Facts panel.
- Add a scanned or typed product to My Stack.
- Run the dose check.
- Add a medication and run the interaction check.
- Save and print a Decision Card.
- Open `/api/health` and `/health` in production.

## Cost

Current project cost is expected to stay near zero for the showcase:

- Vercel Hobby hosting.
- Supabase free tier.
- Gemini embeddings within free or low-cost limits.
- FAU Trussed generation supplied for the project.

At larger scale, generation tokens are the dominant cost. The first production
optimization should be answer caching for repeat questions.

