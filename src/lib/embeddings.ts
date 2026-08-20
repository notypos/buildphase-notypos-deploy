// Embeddings via Google-direct Gemini (gemini-embedding-001, truncated to 768 dims).
// Trussed is NOT an option: its allowlist is chat models only — an embeddings
// request there returns "not listed in LLM access list nor model pool".
import { GoogleGenAI } from '@google/genai';
import { EMBEDDING_MODEL, EMBEDDING_DIMS } from './llm/models';

let client: GoogleGenAI | null = null;

function ai(): GoogleGenAI {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY missing — required for embeddings.');
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

/**
 * `taskType` materially changes retrieval quality: documents must be embedded
 * as RETRIEVAL_DOCUMENT and queries as RETRIEVAL_QUERY. Embedding both the same
 * way is a common and hard-to-spot cause of mediocre recall.
 */
export type EmbedTask = 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY';

/**
 * gemini-embedding-001 only unit-normalizes its full 3072-dim output. Truncated
 * dimensions (1536, 768) come back unnormalized, which skews similarity scores
 * and makes any fixed threshold meaningless. Normalize to unit length so cosine
 * similarity behaves and RETRIEVAL_MIN_SIMILARITY stays comparable across runs.
 */
function normalize(v: number[]): number[] {
  const mag = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
  return mag > 0 ? v.map((x) => x / mag) : v;
}

async function embedBatch(texts: string[], taskType: EmbedTask): Promise<number[][]> {
  const resp = await ai().models.embedContent({
    model: EMBEDDING_MODEL,
    contents: texts,
    config: { taskType, outputDimensionality: EMBEDDING_DIMS },
  });

  const vectors = (resp.embeddings ?? []).map((e) => e.values ?? []);
  if (vectors.length !== texts.length) {
    throw new Error(`Embedding count mismatch: sent ${texts.length}, got ${vectors.length}`);
  }
  for (const v of vectors) {
    if (v.length !== EMBEDDING_DIMS) {
      throw new Error(`Expected ${EMBEDDING_DIMS}-dim embedding, got ${v.length}`);
    }
  }
  return vectors.map(normalize);
}

// ---------------------------------------------------------------------------
// Free-tier pacing.
//
// gemini-embedding-001's free tier caps at roughly 30k tokens/minute. Chunks
// average ~300 tokens, so ~100 chunks/minute is the sustainable ceiling. We send
// small batches on a fixed interval rather than firing as fast as possible —
// staying under the limit is much faster end-to-end than tripping it and waiting
// out 60-second cooldowns.
//
// Set EMBED_BATCH_SIZE / EMBED_INTERVAL_MS to go faster on a paid key.
// ---------------------------------------------------------------------------
const BATCH_SIZE = Number(process.env.EMBED_BATCH_SIZE ?? 8);
const MIN_INTERVAL_MS = Number(process.env.EMBED_INTERVAL_MS ?? 5000);

// 429 means the per-minute window is exhausted, so backoff must exceed 60s.
const RATE_LIMIT_DELAYS = [15_000, 45_000, 70_000, 70_000];

let lastRequestAt = 0;

async function pace(): Promise<void> {
  const wait = MIN_INTERVAL_MS - (Date.now() - lastRequestAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
}

function isRateLimit(err: unknown): boolean {
  return /429|quota|rate limit|RESOURCE_EXHAUSTED/i.test(String(err));
}

function isTransient(err: unknown): boolean {
  return /50\d|ECONNRESET|ETIMEDOUT|fetch failed|socket hang up/i.test(String(err));
}

export interface EmbedProgress {
  done: number;
  total: number;
}

/** Embed many documents, paced to stay inside the free-tier quota. */
export async function embedDocuments(
  texts: string[],
  { onProgress }: { onProgress?: (p: EmbedProgress) => void } = {},
): Promise<number[][]> {
  const out: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const slice = texts.slice(i, i + BATCH_SIZE);
    let attempt = 0;

    for (;;) {
      await pace();
      try {
        out.push(...(await embedBatch(slice, 'RETRIEVAL_DOCUMENT')));
        break;
      } catch (err) {
        const rateLimited = isRateLimit(err);
        if ((!rateLimited && !isTransient(err)) || attempt >= RATE_LIMIT_DELAYS.length) throw err;

        const wait = rateLimited ? RATE_LIMIT_DELAYS[attempt] : 3000 * 2 ** attempt;
        console.warn(
          `      [embed] ${rateLimited ? 'quota' : 'transient'} error on chunks ${i}-${i + slice.length - 1}; waiting ${Math.round(wait / 1000)}s (attempt ${attempt + 1}/${RATE_LIMIT_DELAYS.length})`,
        );
        await new Promise((r) => setTimeout(r, wait));
        // A 429 means the whole minute window is spent; reset pacing.
        lastRequestAt = Date.now();
        attempt++;
      }
    }

    onProgress?.({ done: Math.min(i + BATCH_SIZE, texts.length), total: texts.length });
  }

  return out;
}

/** Embed a single user query. Not paced — one request, on the request path. */
export async function embedQuery(text: string): Promise<number[]> {
  const [v] = await embedBatch([text], 'RETRIEVAL_QUERY');
  return v;
}
