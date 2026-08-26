// Thin client for NIH's DSLD Label API (api.ods.od.nih.gov/dsld/v9) --
// public, unauthenticated, no key required. Verified live (Aug 26, via a
// direct fetch, not just the API's own docs page -- that page under-
// documents the schema):
//   GET /v9/search-filter?q=<text>&size=<n>  -> { hits: [{ _id, ... }], stats }
//   GET /v9/label/{id}                        -> full label record
//     { fullName, brandName, upcSku, ingredientRows: [{ name, quantity: [{quantity, unit}] }] }
// This sandbox's egress allowlist blocks api.ods.od.nih.gov for a *running*
// server process (confirmed separately from the one-off verification
// fetches above), so this module's first real exercise is on a machine with
// normal internet access. Every call fails closed (empty array / null) and
// logs the raw response on a shape mismatch, rather than throwing into a
// 500 the user sees as "something broke."
import 'server-only';
import { normalizeUnit } from '@/lib/nih/units';

export { scoreMatches, pickBestMatch, type ScoredMatch } from './match';

const BASE = 'https://api.ods.od.nih.gov/dsld/v9';

export interface DsldSearchHit {
  id: string;
  fullName: string;
  brandName: string | null;
}

export interface DsldIngredientRow {
  name: string;
  amount: number | null;
  unit: string | null; // normalized to mcg|mg|g|iu, or null if unmapped
}

export interface DsldLabel {
  id: string;
  fullName: string;
  brandName: string | null;
  upcSku: string | null;
  ingredients: DsldIngredientRow[];
}

async function dsldFetch(path: string): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`DSLD ${path} -> ${res.status}`);
  return res.json();
}

/**
 * DSLD spells units out ("Milligram(s)", "Microgram(s)", "International
 * Unit(s)") where the rest of this app uses mg/mcg/g/iu (see
 * src/lib/nih/units.ts) -- map the common long forms before handing off to
 * normalizeUnit(), so these rows can actually participate in the
 * cumulative-dose check instead of being silently unusable.
 */
function mapDsldUnit(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const u = raw.toLowerCase();
  if (u.startsWith('microgram')) return 'mcg';
  if (u.startsWith('milligram')) return 'mg';
  if (u.startsWith('gram')) return 'g';
  if (u.startsWith('international unit') || u === 'iu') return 'iu';
  return normalizeUnit(raw); // already-short forms (mg, mcg, ...) fall through here
}

export async function searchDsldByName(name: string, size = 5): Promise<DsldSearchHit[]> {
  const q = encodeURIComponent(name);
  let body: unknown;
  try {
    body = await dsldFetch(`/search-filter?q=${q}&size=${size}`);
  } catch (err) {
    console.warn('[dsld] search failed', err instanceof Error ? err.message : err);
    return [];
  }

  const hits = (body as { hits?: unknown[] })?.hits;
  if (!Array.isArray(hits)) {
    console.warn('[dsld] search response missing hits[]', JSON.stringify(body).slice(0, 300));
    return [];
  }

  return hits
    .map((h) => {
      const rec = h as Record<string, unknown>;
      // Elasticsearch-style hit: fields may sit under _source, or (per one
      // live response) flattened onto the hit itself -- accept both rather
      // than gamble on which shape a given response uses.
      const source = (rec._source as Record<string, unknown>) ?? rec;
      const id = rec._id ?? rec.id;
      const fullName = source.fullName;
      if ((typeof id !== 'string' && typeof id !== 'number') || typeof fullName !== 'string') {
        return null;
      }
      return {
        id: String(id),
        fullName,
        brandName: typeof source.brandName === 'string' ? source.brandName : null,
      };
    })
    .filter((h): h is DsldSearchHit => h !== null);
}

export async function getDsldLabel(id: string): Promise<DsldLabel | null> {
  let body: unknown;
  try {
    body = await dsldFetch(`/label/${encodeURIComponent(id)}`);
  } catch (err) {
    console.warn('[dsld] label fetch failed', err instanceof Error ? err.message : err);
    return null;
  }

  const rec = body as Record<string, unknown>;
  const fullName = rec.fullName;
  if (typeof fullName !== 'string') {
    console.warn('[dsld] label response missing fullName', JSON.stringify(rec).slice(0, 300));
    return null;
  }

  const rows = Array.isArray(rec.ingredientRows) ? rec.ingredientRows : [];
  const ingredients: DsldIngredientRow[] = rows.map((r) => {
    const row = r as Record<string, unknown>;
    const name = typeof row.name === 'string' ? row.name : 'Unknown ingredient';
    const quantities = Array.isArray(row.quantity) ? row.quantity : [];
    const q0 = quantities[0] as Record<string, unknown> | undefined;
    const amount = typeof q0?.quantity === 'number' ? q0.quantity : null;
    const unit = mapDsldUnit(typeof q0?.unit === 'string' ? q0.unit : null);
    return { name, amount, unit };
  });

  return {
    id,
    fullName,
    brandName: typeof rec.brandName === 'string' ? rec.brandName : null,
    upcSku: typeof rec.upcSku === 'string' ? rec.upcSku : null,
    ingredients,
  };
}

