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

export type InteractionFinding = z.infer<typeof FindingSchema>;

// Per-supplement model output. Deliberately does NOT ask the model to repeat
// back which supplement it's talking about — see the "one call per
// supplement" note below for why. We attach `supplement` ourselves in code
// once the call returns, so the model can't mislabel it.
const PerSupplementFindingSchema = z.object({
  medication: z.string(),
  flagged: z.boolean(),
  detail: z.string().max(500),
});
const PerSupplementResultSchema = z.object({
  findings: z.array(PerSupplementFindingSchema).max(20),
});

// Kept for reference/typing of the final merged shape returned to the client
// — no longer the schema of a single model call (see checkInteractions).
export const InteractionResultSchema = z.object({
  findings: z.array(FindingSchema).max(80),
  summary: z.string().max(500),
});
export type InteractionResult = z.infer<typeof InteractionResultSchema>;

const SYSTEM = `You check whether NIH fact sheet excerpts (from the Office of Dietary Supplements and
the National Center for Complementary and Integrative Health) mention an interaction or caution
between ONE supplement and a list of medications. You are not a doctor and you do not use outside
medical knowledge — you report ONLY what is stated in the excerpts you are given for this one
supplement.

For every medication in the list:
- flagged = true only if the excerpts name that medication, or its drug class (e.g. "blood
  thinners" covers warfarin), in an interaction or caution context.
- flagged = false otherwise. detail must then say the fact sheet doesn't mention that
  medication — never say the combination is "safe" or "fine". Absence of a mention is not
  evidence of safety.

Ground every "detail" in the actual excerpt text (paraphrase or quote it briefly). Reply with
JSON only, matching the given shape exactly — one entry per medication, no more, no fewer.`;

export interface CheckInteractionsResult extends InteractionResult {
  /** Supplement names that had no matching NIH fact sheet at all. */
  uncovered: string[];
  /**
   * Supplements that DID have NIH content but whose model check itself
   * failed (timeout / provider error) after retries. Kept separate from
   * `uncovered` so a real failure is visible instead of silently reading as
   * "nothing found."
   */
  failed: string[];
}

const MEDICATION_ALIASES: Record<string, string[]> = {
  warfarin: ['warfarin', 'coumadin', 'jantoven', 'blood thinner', 'blood thinners', 'anticoagulant', 'anticoagulants'],
  enalapril: ['enalapril', 'ace inhibitor', 'ace inhibitors', 'angiotensin converting enzyme inhibitor'],
  lisinopril: ['lisinopril', 'ace inhibitor', 'ace inhibitors', 'angiotensin converting enzyme inhibitor'],
};

function medicationTerms(name: string): string[] {
  const key = name.toLowerCase().trim();
  return [...new Set([key, ...(MEDICATION_ALIASES[key] ?? [])].filter((term) => term.length >= 3))];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasTerm(text: string, terms: string[]): boolean {
  return terms.some((term) => new RegExp(`\\b${escapeRegExp(term)}\\b`, 'i').test(text));
}

function directInteractionDetail(digest: string, medication: string): string | null {
  const terms = medicationTerms(medication);
  const sentence = digest
    .replace(/\[[0-9]+\]\s+/g, '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .find(
      (s) =>
        hasTerm(s, terms) &&
        /\b(interact|interfere|bleeding|blood clot|risk|unsafe|caution|talk with|consult)\b/i.test(s),
    );

  if (!sentence) return null;
  return sentence.length > 480 ? `${sentence.slice(0, 477).trim()}...` : sentence;
}

/** Run `fn` over `items` with at most `limit` calls in flight at once. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = { status: 'fulfilled', value: await fn(items[i]) };
      } catch (reason) {
        results[i] = { status: 'rejected', reason };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export async function checkInteractions(
  supplementNamesRaw: string[],
  medicationNamesRaw: string[],
): Promise<CheckInteractionsResult> {
  const supplements = [...new Set(supplementNamesRaw.map((s) => s.trim()).filter(Boolean))].slice(0, 10);
  const medications = [...new Set(medicationNamesRaw.map((s) => s.trim()).filter(Boolean))].slice(0, 10);

  const uncovered: string[] = [];
  const covered: { name: string; digest: string }[] = [];

  for (const name of supplements) {
    const { chunks, belowThreshold } = await retrieve(name, { matchCount: 4 });
    if (belowThreshold) {
      uncovered.push(name);
      continue;
    }
    const safety = await retrieveSafetySections(chunks, { limit: 6 });
    covered.push({ name, digest: formatContext([...chunks, ...safety]) });
  }

  if (covered.length === 0) {
    return {
      findings: [],
      failed: [],
      summary:
        'None of the supplements entered matched an NIH ODS fact sheet closely enough to check — try the exact ingredient name (e.g. "Vitamin D" rather than a brand name).',
      uncovered,
    };
  }

  // One isolated model call PER SUPPLEMENT, not one call for the whole
  // supplement × medication cross-product.
  //
  // The earlier version concatenated every supplement's NIH excerpts into a
  // single prompt and asked the model to fill in the full cross-product of
  // findings in one JSON response. That's the actual cause of "1 supplement
  // = correct, 2+ = wrong": it's not an API/rate limit (a real 429 surfaces
  // as an explicit error, not quiet wrong output) — it's the model
  // conflating which excerpt belongs to which supplement as the prompt and
  // the required output both grow, especially with a temperature 0.1 model
  // still asked to produce many structured entries in one shot. Checking one
  // supplement at a time reproduces exactly the shape that was already
  // confirmed correct (the single-supplement case), for every supplement.
  //
  // Concurrency is capped (not one unbounded Promise.all) so checking
  // several supplements at once doesn't itself trip Trussed's per-key rate
  // limit — that failure mode is real, just not the one that was happening.
  const settled = await mapWithConcurrency(covered, 3, async ({ name, digest }) => {
    const prompt = `Medications entered: ${medications.join(', ')}

Medication aliases/classes to count as matches:
${medications.map((m) => `- ${m}: ${medicationTerms(m).join(', ')}`).join('\n')}

NIH ODS fact sheet excerpts for "${name}":

${digest}

Check "${name}" against every medication listed above and return one findings entry per
medication.`;

    const result = await generateStructured(PerSupplementResultSchema, {
      system: SYSTEM,
      prompt,
      temperature: 0.1,
      maxTokens: 1200,
      timeoutMs: 30000,
    });
    return result.findings.map((f): InteractionFinding => {
      if (f.flagged) return { ...f, supplement: name };
      const directDetail = directInteractionDetail(digest, f.medication);
      return directDetail
        ? { ...f, flagged: true, detail: directDetail, supplement: name }
        : { ...f, supplement: name };
    });
  });

  const findings: InteractionFinding[] = [];
  const failed: string[] = [];
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') findings.push(...r.value);
    else {
      failed.push(covered[i].name);
      console.error(`[interactions] check failed for "${covered[i].name}"`, r.reason);
    }
  });

  // Summary is built deterministically, not by the model — one less thing
  // for the model to get wrong or word unsafely, and it can't drift from
  // what `findings` actually says.
  const flaggedCount = findings.filter((f) => f.flagged).length;
  const summary =
    flaggedCount > 0
      ? `Based on the information you provided, NIH's fact sheets mention ${flaggedCount} potential interaction${
          flaggedCount === 1 ? '' : 's'
        } between what you're taking and what you listed. This only reflects what NIH's fact sheets say, not a full drug-interaction review.`
      : `Based on the information you provided, NIH's fact sheets did not mention an interaction between the supplements checked and the medications you listed. This isn't a full drug-interaction review — absence of a mention is not evidence of safety.`;

  return { findings, summary, uncovered, failed };
}
