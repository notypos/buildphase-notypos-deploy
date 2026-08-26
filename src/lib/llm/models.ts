// Client-safe model registry — NO API keys here.
// Provider ids resolve to keys/endpoints server-side in src/lib/llm/index.ts.

export type ProviderId = 'google' | 'trussed-openai' | 'trussed-gemini';

export interface LlmOption {
  id: string;
  providerId: ProviderId;
  model: string;
  label: string;
}

export const DEFAULT_MODEL_ID = 'trussed-openai/gpt-5.4';

export const LLM_OPTIONS: LlmOption[] = [
  { id: 'trussed-openai/gpt-5.4', providerId: 'trussed-openai', model: 'gpt-5.4', label: 'GPT-5.4 · FAU Trussed' },
  { id: 'trussed-gemini/gemini-2.5-pro', providerId: 'trussed-gemini', model: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro · FAU Trussed' },
  // google's own gemini-2.5-flash was retired for our key (404, "no longer
  // available to new users") on 2026-08-25 — replaced with 3.6-flash, the
  // model Google's own error message named as the successor.
  { id: 'google/gemini-3.6-flash', providerId: 'google', model: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash · Google direct' },
  { id: 'trussed-openai/cogito:14b', providerId: 'trussed-openai', model: 'cogito:14b', label: 'Cogito 14B · FAU Trussed' },
];

export function defaultOption(): LlmOption {
  return LLM_OPTIONS.find((o) => o.id === DEFAULT_MODEL_ID) ?? LLM_OPTIONS[0];
}

export function findModelOption(id?: string | null): LlmOption {
  return LLM_OPTIONS.find((o) => o.id === id) ?? defaultOption();
}

// Vision candidates for the label scanner, tried in order until one works.
// Trussed first: it draws on FAU's provisioned budget instead of the
// personal free-tier Google key, so a demo doesn't depend on personal quota.
// Direct Google is the last-resort fallback. Not every candidate is
// guaranteed to actually support image input server-side — scan-label.ts
// catches a failure and moves to the next one rather than assuming.
export const VISION_MODEL_CANDIDATES = [
  'trussed-openai/gpt-5.4',
  'trussed-gemini/gemini-2.5-pro',
  'google/gemini-3.6-flash',
];

// Embeddings are Google-direct only. Trussed may or may not expose
// /embeddings — verify before depending on it.
//
// text-embedding-004 was retired; gemini-embedding-001 replaces it. It returns
// 3072 dims by default and supports Matryoshka truncation to 1536 or 768. We
// take 768 to keep the pgvector column small — truncated output is NOT unit
// normalized, so embeddings.ts normalizes it.
export const EMBEDDING_MODEL = 'gemini-embedding-001';
export const EMBEDDING_DIMS = 768;
