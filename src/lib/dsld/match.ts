// Pure name/brand matching for DSLD search results -- deliberately no
// 'server-only' here and no network calls, so this can be unit-tested
// directly (scripts/test-dsld-match.ts) without going through the DSLD
// client's server-only guard or a live API call.
import type { DsldSearchHit } from './client';

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean);
}

export interface ScoredMatch {
  hit: DsldSearchHit;
  score: number;
}

/**
 * Ranking heuristic, not a real relevance model. Brand match matters most,
 * but among same-brand hits, DSLD's own search order is not reliable enough
 * to trust blindly: a real bug (Aug 26) had a plain "Super B-Complex" photo
 * match DSLD's "Super B-Complex WITH VITAMIN C" instead, because that was
 * simply what DSLD's search ranked first for the brand -- a same-brand
 * near-miss that carries a materially different ingredient list, which is
 * worse than no match at all.
 *
 * So this also scores on word overlap against what the vision model actually
 * read off the front of the bottle: a hit is rewarded for containing the
 * words the photo showed, and penalized for extra words the photo did NOT
 * show ("with", "vitamin", "c" above) -- since those extra words are exactly
 * what distinguishes one manufacturer's variant from another. The plain,
 * unqualified name wins over the fancier variant unless the photo itself
 * named that variant.
 */
export function scoreMatches(hits: DsldSearchHit[], wantBrand: string | null, wantName: string | null): ScoredMatch[] {
  const brandLower = wantBrand?.toLowerCase() ?? null;
  const nameTokens = new Set(tokenize(wantName ?? ''));

  return hits
    .map((hit) => {
      const brandOk = brandLower ? (hit.brandName?.toLowerCase().includes(brandLower) ?? false) : true;
      const hitTokens = tokenize(hit.fullName);
      const overlap = hitTokens.filter((t) => nameTokens.has(t)).length;
      const extra = hitTokens.filter((t) => !nameTokens.has(t)).length;
      const score = (brandOk ? 1000 : 0) + overlap * 10 - extra;
      return { hit, score };
    })
    .sort((a, b) => b.score - a.score);
}

export function pickBestMatch(
  hits: DsldSearchHit[],
  wantBrand: string | null,
  wantName: string | null = null,
): DsldSearchHit | null {
  return scoreMatches(hits, wantBrand, wantName)[0]?.hit ?? null;
}
