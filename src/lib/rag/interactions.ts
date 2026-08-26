// Supplement × medication interaction check.
//
// This is NOT a dose comparison (that's src/lib/nih/stack-check.ts — pure
// arithmetic, no model). An interaction is a free-text claim ("may increase
// bleeding risk with anticoagulants"), so there is no table to look up — it
// has to come from the model reading the retrieved NIH fact sheet text. The
// model's job is strictly to report what the retrieved excerpts say, never to
// reason from its own general medical knowledge, and to say "not mentioned"
// rather than imply safety when a pair isn't covered.
import 'server-only';
import { z } from 'zod';
import { generateStructured } from '@/lib/llm';
import { retrieve, retrieveSafetySections, formatContext } from './retrieve';

const FindingSchema = z.object({
  supplement: z.string(),
  medication: z.string(),
  // true only when the excerpts actually name this medication (or its class)
  // in an interaction/caution context.
  flagged: z.boolean(),
  detail: z.string().max(500),
});

export const InteractionResultSchema = z.object({
  findings: z.array(FindingSchema).max(80),
  summary: z.string().max(500),
});
export type InteractionResult = z.infer<typeof InteractionResultSchema>;
export type InteractionFinding = z.infer<typeof FindingSchema>;

const SYSTEM = `You check whether NIH Office of Dietary Supplements fact sheet excerpts mention
an interaction or caution between a supplement and a medication. You are not a doctor and you
do not use outside medical knowledge — you report ONLY what is stated in the excerpts you are
given, for each fact sheet included below.

For every (supplement, medication) pair:
- flagged = true only if the excerpts name that medication, or its drug class (e.g. "blood
  thinners" covers warfarin), in an interaction or caution context.
- flagged = false otherwise. detail must then say the fact sheet doesn't mention that
  medication — never say the combination is "safe" or "fine". Absence of a mention is not
  evidence of safety.

Ground every "detail" in the actual excerpt text (paraphrase or quote it briefly). Write a short
overall "summary" starting with "Based on the information you provided, ODS documents…" and
noting this only covers what NIH's fact sheets say, not a full drug-interaction review.

Reply with JSON only, matching the given shape exactly.`;

export interface CheckInteractionsResult extends InteractionResult {
  /** Supplement names that had no matching NIH fact sheet at all. */
  uncovered: string[];
}

export async function checkInteractions(
  supplementNamesRaw: string[],
  medicationNamesRaw: string[],
): Promise<CheckInteractionsResult> {
  const supplements = [...new Set(supplementNamesRaw.map((s) => s.trim()).filter(Boolean))].slice(0, 10);
  const medications = [...new Set(medicationNamesRaw.map((s) => s.trim()).filter(Boolean))].slice(0, 10);

  const digests: string[] = [];
  const uncovered: string[] = [];

  for (const name of supplements) {
    const { chunks, belowThreshold } = await retrieve(name, { matchCount: 4 });
    if (belowThreshold) {
      uncovered.push(name);
      continue;
    }
    const safety = await retrieveSafetySections(chunks, { limit: 6 });
    digests.push(`## ${name}\n${formatContext([...chunks, ...safety])}`);
  }

  if (digests.length === 0) {
    return {
      findings: [],
      summary:
        'None of the supplements entered matched an NIH ODS fact sheet closely enough to check — try the exact ingredient name (e.g. "Vitamin D" rather than a brand name).',
      uncovered,
    };
  }

  const prompt = `Medications entered: ${medications.join(', ')}

NIH ODS fact sheet excerpts, one section per supplement:

${digests.join('\n\n---\n\n')}

For every supplement above, check it against every medication listed and fill in the findings
array (one entry per supplement/medication pair).`;

  const result = await generateStructured(InteractionResultSchema, {
    system: SYSTEM,
    prompt,
    temperature: 0.1,
    maxTokens: 3000,
    timeoutMs: 45000,
  });

  return { ...result, uncovered };
}
