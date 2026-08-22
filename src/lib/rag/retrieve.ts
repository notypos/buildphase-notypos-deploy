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


/**
 * Sections that carry condition and drug-interaction guidance.
 *
 * Semantic search on "is vitamin K safe?" reliably returns the overview and
 * dosage sections and often misses the interactions section entirely — the
 * question doesn't mention drugs, so nothing in it is close to that text. Rather
 * than embedding the reader's medication list to fix that (which would ship it
 * to a provider that trains on free-tier input), fetch these sections directly
 * from whichever fact sheets the semantic pass already landed on. No extra
 * embedding call, and the sections are guaranteed present when they exist.
 */
const SAFETY_SECTION_PATTERNS = [
  '%interact%',      // "Does X interact with medications or other dietary supplements?"
  '%harmful%',       // "Can X be harmful?"
  '%health%',        // "What are some effects of X on health?"
  '%not get enough%',// "What happens if I don't get enough X?"
  '%getting enough%',// "Am I getting enough X?"
];

/**
 * Pull safety and condition sections for the fact sheets a search landed on.
 * Returns chunks not already in `existing`, capped so they cannot crowd out the
 * semantically-matched content.
 */
export async function retrieveSafetySections(
  existing: RetrievedChunk[],
  { limit = 6 }: { limit?: number } = {},
): Promise<RetrievedChunk[]> {
  if (existing.length === 0) return [];

  // Only the sheets the question is actually about — the top two by best match.
  const bySheet = new Map<string, number>();
  for (const c of existing) {
    bySheet.set(c.fact_sheet_id, Math.max(bySheet.get(c.fact_sheet_id) ?? 0, c.similarity));
  }
  const sheetIds = [...bySheet.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([id]) => id);

  const have = new Set(existing.map((c) => c.chunk_id));
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('chunks')
    .select('id, fact_sheet_id, section, subsection, content, fact_sheets!inner(slug, supplement, source_url)')
    .in('fact_sheet_id', sheetIds)
    .or(SAFETY_SECTION_PATTERNS.map((p) => `section.ilike.${p}`).join(','))
    .limit(30);

  if (error) {
    // Non-fatal: the answer is still grounded in the semantic results.
    console.warn(`[retrieval] safety-section fetch failed: ${error.message}`);
    return [];
  }

  type Row = {
    id: string;
    fact_sheet_id: string;
    section: string | null;
    subsection: string | null;
    content: string;
    fact_sheets: { slug: string; supplement: string; source_url: string } | null;
  };

  return ((data ?? []) as unknown as Row[])
    .filter((r) => !have.has(r.id) && r.fact_sheets)
    .slice(0, limit)
    .map((r) => ({
      chunk_id: r.id,
      fact_sheet_id: r.fact_sheet_id,
      slug: r.fact_sheets!.slug,
      supplement: r.fact_sheets!.supplement,
      section: r.section,
      subsection: r.subsection,
      content: r.content,
      source_url: r.fact_sheets!.source_url,
      // Not semantically scored — included structurally, so mark it as such
      // rather than inventing a similarity that would distort the threshold.
      similarity: 0,
    }));
}
