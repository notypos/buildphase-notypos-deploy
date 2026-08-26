import 'server-only';
import { z } from 'zod';
import { generateStructured } from '@/lib/llm';
import {
  retrieve,
  retrieveSafetySections,
  formatContext,
  toCitations,
  dedupeCitations,
  type DisplayCitation,
} from './retrieve';
import type { HealthContext } from '@/lib/health-context';
import { ageEmphasis, describeContext } from './prompt-context';

export const AUDIENCES = ['simple', 'standard'] as const;
export type Audience = (typeof AUDIENCES)[number];

const AUDIENCE_STYLE: Record<Audience, string> = {
  simple:
    'Grade 6-8 reading level. Short sentences, one idea each, everyday words. Gloss any term a general reader would not know. Never condescending.',
  standard: 'Grade 8-10 reading level. Plain language; explain jargon the first time it appears.',
};


/**
 * The three core fields come from the project problem statement: separate
 * evidence from uncertainty from marketing.
 *
 * The three optional fields exist so condition and interaction guidance can
 * surface FROM THE SOURCES without asking the reader for a medical history.
 * Each is omitted when the retrieved text says nothing — an empty section is a
 * truthful outcome, and padding it would be the exact failure this design avoids.
 */
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
  forYou: z
    .string()
    .optional()
    .describe(
      'Only when the reader supplied age, sex, or life stage AND the sources give amounts or cautions for that group. Begin "Based on the information you provided". Omit otherwise.',
    ),
  healthConsiderations: z
    .string()
    .optional()
    .describe(
      'Conditions or groups the SOURCES specifically connect to this nutrient (kidney disease, malabsorption, vegetarian diets, older age). Report only what is in the context. Omit when the sources name none.',
    ),
  medicationInteractions: z
    .string()
    .optional()
    .describe(
      'Medications or drug classes the SOURCES list as interacting, named as the sources name them. Omit when the sources list none.',
    ),
  questionsForClinician: z
    .array(z.string())
    .max(4)
    .optional()
    .describe(
      'Up to 4 short, specific questions the reader could ask a clinician, each arising from something in the context (an interaction, an upper limit, a condition). Not generic advice. Omit when the sources support none.',
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
- Use ONLY the numbered context provided. It comes from NIH fact sheets (the Office of Dietary Supplements and the National Center for Complementary and Integrative Health).
- Never add facts from your own knowledge, even if you are confident they are correct.
- Cite every factual sentence with the bracketed number of its source, like [2].
- If the context does not answer the question, leave the relevant field as an empty string. Do not speculate.
- Never give personal medical advice, dosing instructions for an individual, or a diagnosis.
- Do not tell anyone to start, stop, or change a supplement or medication. Refer them to a clinician.
- Write in the reader's language: if the question is in Spanish, answer in Spanish.

"forYou" — only when the reader gave age, sex, or life stage AND the sources give amounts
or cautions for that group:
- Open with "Based on the information you provided" — never "based on your medical history".
- Report only what the sources say about that group. Never state something is safe or unsafe
  FOR THEM; report what NIH documents and point them to a clinician.
- Omit the field entirely when they supplied nothing or the sources are silent.

"healthConsiderations" — conditions or groups the SOURCES themselves connect to this
nutrient: kidney disease, malabsorption conditions, vegetarian diets, older age, and so on.
Report only what appears in the context. Omit when the sources name none. We never ask the
reader about their health conditions, so do not address them as if you know their health
status — write "ODS notes that people with X..." and never "because you have X...".

"medicationInteractions" — drugs or drug classes the SOURCES list as interacting, named as
the sources name them. Omit when the sources list none. Never infer an interaction from
pharmacological reasoning: if it is not in the context, it does not go in the field.

"questionsForClinician" — short, specific questions this reader could raise at an
appointment, each traceable to something in the context: an interaction the sources list, an
upper limit they are near, a condition the sources connect to the nutrient. Not generic
filler like "ask if this is right for me". Omit the field when the context supports none.`;

export async function ask(
  question: string,
  {
    audience = 'standard',
    language = 'en',
    healthContext,
  }: { audience?: Audience; language?: 'en' | 'es'; healthContext?: HealthContext } = {},
): Promise<AskResult> {
  // NOTE: only `question` is embedded. Health context is NEVER part of a
  // retrieval query — see the guard in src/lib/embeddings.ts.
  const { chunks, topSimilarity, belowThreshold } = await retrieve(question, { language });

  if (belowThreshold) {
    return {
      answer: null,
      citations: [],
      refused: true,
      refusalReason:
        "The NIH fact sheets in this system don't cover this question. I only answer from those sources, so I don't have an answer for you here.",
      topSimilarity,
      chunkIds: [],
    };
  }

  // Pull the interaction / harm / health-effects sections from the sheets the
  // search landed on. Semantic search misses these whenever the question does
  // not mention drugs or conditions, which is most of the time — and those
  // sections are exactly where condition and interaction guidance lives.
  const safetyChunks = await retrieveSafetySections(chunks);
  const allChunks = [...chunks, ...safetyChunks];

  const answer = await generateStructured(AnswerSchema, {
    system: SYSTEM,
    prompt: `Reader: ${AUDIENCE_STYLE[audience]}${ageEmphasis(healthContext?.ageYears)}
${describeContext(healthContext)}
Question: ${question}

Context:
${formatContext(allChunks)}

Return JSON with keys: evidence, uncertainty, marketing, forYou (optional),
healthConsiderations (optional), medicationInteractions (optional),
questionsForClinician (optional), citationsUsed.`,
    temperature: 0.2,
    maxTokens: 2048,
  });

  return {
    answer,
    citations: dedupeCitations(toCitations(allChunks), answer.citationsUsed),
    refused: false,
    topSimilarity,
    chunkIds: allChunks.map((c) => c.chunk_id),
  };
}

