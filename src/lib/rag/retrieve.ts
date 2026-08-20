import 'server-only';
import { createServiceClient } from '@/lib/supabase/server';
import { embedQuery } from '@/lib/embeddings';

export interface RetrievedChunk {
  chunk_id: string;
  fact_sheet_id: string;
  slug: string;
  supplement: string;
  section: string | null;
  subsection: string | null;
  content: string;
  source_url: string;
  similarity: number;
}

export interface RetrieveOptions {
  /** 'consumer' reads better for lay users; 'health_professional' has the detail. */
  audience?: 'consumer' | 'health_professional' | null;
  language?: 'en' | 'es';
  matchCount?: number;
  /** Below this the caller should refuse rather than answer. */
  minSimilarity?: number;
}

// 0.66 is measured, not guessed: scripts/ask.ts --suite put in-scope questions
// at 0.755-0.800 and off-topic ones at 0.503-0.630 against the 579-chunk corpus.
// Re-run that suite after any change to chunking or the embedding model.
export const DEFAULT_MIN_SIMILARITY = Number(process.env.RETRIEVAL_MIN_SIMILARITY ?? 0.66);

export interface RetrievalResult {
  chunks: RetrievedChunk[];
  topSimilarity: number;
  /** True when nothing cleared the floor — the caller must not answer from the model's own knowledge. */
  belowThreshold: boolean;
}

/**
 * Retrieve grounding chunks for a question.
 *
 * The floor is the whole point: an empty result is a legitimate outcome that
 * means "NIH ODS does not cover this", and it must not be papered over by
 * letting the model answer unaided.
 */
export async function retrieve(query: string, opts: RetrieveOptions = {}): Promise<RetrievalResult> {
  const {
    audience = 'consumer',
    language = 'en',
    matchCount = 8,
    minSimilarity = DEFAULT_MIN_SIMILARITY,
  } = opts;

  const embedding = await embedQuery(query);
  const supabase = createServiceClient();

  const { data, error } = await supabase.rpc('match_chunks', {
    query_embedding: embedding,
    match_count: matchCount,
    filter_audience: audience,
    filter_language: language,
    min_similarity: 0, // rank everything, apply the floor here so we can log near-misses
  });

  if (error) throw new Error(`Retrieval failed: ${error.message}`);

  const all = (data ?? []) as RetrievedChunk[];
  const topSimilarity = all[0]?.similarity ?? 0;
  const chunks = all.filter((c) => c.similarity >= minSimilarity);

  if (chunks.length === 0 && all.length > 0) {
    console.log(
      `[retrieval] below floor (${minSimilarity}): best was ${topSimilarity.toFixed(3)} — ${all[0].slug} / ${all[0].section}`,
    );
  }

  return { chunks, topSimilarity, belowThreshold: chunks.length === 0 };
}

/** Numbered context block for the prompt. Numbers become the citation markers. */
export function formatContext(chunks: RetrievedChunk[]): string {
  return chunks
    .map((c, i) => {
      const heading = [c.section, c.subsection].filter(Boolean).join(' — ');
      return `[${i + 1}] ${c.supplement} — ${heading}\n${c.content}`;
    })
    .join('\n\n---\n\n');
}

export interface Citation {
  index: number;
  supplement: string;
  section: string | null;
  subsection: string | null;
  slug: string;
  url: string;
  chunkId: string;
}

export function toCitations(chunks: RetrievedChunk[]): Citation[] {
  return chunks.map((c, i) => ({
    index: i + 1,
    supplement: c.supplement,
    section: c.section,
    subsection: c.subsection,
    slug: c.slug,
    url: c.source_url,
    chunkId: c.chunk_id,
  }));
}

/**
 * Two chunks from the same sheet section are one source to a reader, even
 * though they are distinct rows. Collapse them for display, keeping every
 * index that mapped to the source so in-text markers still resolve.
 */
export interface DisplayCitation extends Citation {
  indices: number[];
}

export function dedupeCitations(citations: Citation[], used?: number[]): DisplayCitation[] {
  const keep = used ? citations.filter((c) => used.includes(c.index)) : citations;
  const bySection = new Map<string, DisplayCitation>();

  for (const c of keep) {
    const key = `${c.slug}::${c.section ?? ''}::${c.subsection ?? ''}`;
    const existing = bySection.get(key);
    if (existing) existing.indices.push(c.index);
    else bySection.set(key, { ...c, indices: [c.index] });
  }
  return [...bySection.values()].sort((a, b) => a.indices[0] - b.indices[0]);
}
