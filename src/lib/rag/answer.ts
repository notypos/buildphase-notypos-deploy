import 'server-only';
import { z } from 'zod';
import { generateStructured } from '@/lib/llm';
import { retrieve, formatContext, toCitations, dedupeCitations, type DisplayCitation } from './retrieve';

export const AUDIENCES = ['teen', 'adult', 'older_adult', 'caregiver'] as const;
export type Audience = (typeof AUDIENCES)[number];

const AUDIENCE_STYLE: Record<Audience, string> = {
  teen: 'A 14-17 year old. Grade 6-8 reading level. Short sentences, concrete examples, no condescension. Skip clinical jargon entirely.',
  adult: 'A general adult reader. Grade 8-10 reading level. Plain language, no jargon without a gloss.',
  older_adult:
    'An adult over 65. Grade 6-8 reading level. Larger conceptual chunks, one idea per sentence. Foreground medication interactions and kidney/liver considerations where the sources mention them.',
  caregiver:
    'Someone managing supplements for another person. Grade 8-10 reading level. Frame guidance around observing and deciding for someone else, and around what to raise with a clinician.',
};

// The three-way split comes straight from the project problem statement:
// separate evidence from uncertainty from marketing.
export const AnswerSchema = z.object({
  evidence: z
    .string()
    .describe('What the NIH sources actually establish. Cite with [1], [2]. Empty string if the sources say nothing.'),
  uncertainty: z
    .string()
    .describe('What the sources describe as unclear, mixed, or under study. Empty string if not discussed.'),
  marketing: z
    .string()
    .describe(
      'Common marketing claims the sources do NOT support, only when the sources speak to them. Empty string otherwise.',
    ),
  citationsUsed: z.array(z.number().int().positive()).describe('Context numbers actually cited above.'),
});

export type Answer = z.infer<typeof AnswerSchema>;

export interface AskResult {
  answer: Answer | null;
  /** Deduped for display; `chunkIds` keeps the full retrieval trace. */
  citations: DisplayCitation[];
  refused: boolean;
  refusalReason?: string;
  topSimilarity: number;
  chunkIds: string[];
}

const SYSTEM = `You answer questions about dietary supplements for the general public.

Absolute rules:
- Use ONLY the numbered context provided. It comes from NIH Office of Dietary Supplements fact sheets.
- Never add facts from your own knowledge, even if you are confident they are correct.
- Cite every factual sentence with the bracketed number of its source, like [2].
- If the context does not answer the question, leave the relevant field as an empty string. Do not speculate.
- Never give personal medical advice, dosing instructions for an individual, or a diagnosis.
- Do not tell anyone to start, stop, or change a supplement or medication. Refer them to a clinician.
- Write in the reader's language: if the question is in Spanish, answer in Spanish.`;

export async function ask(
  question: string,
  { audience = 'adult', language = 'en' }: { audience?: Audience; language?: 'en' | 'es' } = {},
): Promise<AskResult> {
  const { chunks, topSimilarity, belowThreshold } = await retrieve(question, { language });

  if (belowThreshold) {
    return {
      answer: null,
      citations: [],
      refused: true,
      refusalReason:
        "The NIH Office of Dietary Supplements fact sheets don't cover this question. I only answer from those sources, so I don't have an answer for you here.",
      topSimilarity,
      chunkIds: [],
    };
  }

  const answer = await generateStructured(AnswerSchema, {
    system: SYSTEM,
    prompt: `Reader: ${AUDIENCE_STYLE[audience]}

Question: ${question}

Context:
${formatContext(chunks)}

Return JSON with keys: evidence, uncertainty, marketing, citationsUsed.`,
    temperature: 0.2,
    maxTokens: 2048,
  });

  return {
    answer,
    citations: dedupeCitations(toCitations(chunks), answer.citationsUsed),
    refused: false,
    topSimilarity,
    chunkIds: chunks.map((c) => c.chunk_id),
  };
}
