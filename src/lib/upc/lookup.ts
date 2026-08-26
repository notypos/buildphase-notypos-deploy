// UPC/barcode -> product identity lookup, so a scanned barcode has something
// to search NIH's DSLD database with. DSLD's own API has no barcode
// endpoint (verified against the live API, Aug 26) -- only a `upcSku` field
// on records already found some other way. This is the "some other way": a
// free, keyless barcode database resolves the scanned number to a product
// name/brand, which src/lib/dsld/client.ts then searches DSLD by name for.
//
// UPCitemdb's "trial" tier: no API key, no signup, ~100 lookups/day per IP.
// The exact response shape below is from public documentation, NOT a live
// test call -- this sandbox's egress allowlist blocks api.upcitemdb.com, so
// this gets its first real exercise once someone runs the app with normal
// internet access (locally or on Vercel). It fails closed (returns null)
// rather than throwing, and logs the raw body on an unexpected shape so a
// schema mismatch is a five-second fix, not a silent dead end.
import 'server-only';

const TRIAL_ENDPOINT = 'https://api.upcitemdb.com/prod/trial/lookup';

export interface UpcProduct {
  title: string;
  brand: string | null;
  upc: string;
}

export async function lookupUpc(barcode: string): Promise<UpcProduct | null> {
  const digits = barcode.replace(/\D/g, '');
  if (digits.length < 8) return null; // not a plausible UPC/EAN

  let res: Response;
  try {
    res = await fetch(`${TRIAL_ENDPOINT}?upc=${encodeURIComponent(digits)}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
  } catch (err) {
    console.warn('[upc] lookup request failed', err instanceof Error ? err.message : err);
    return null;
  }

  if (!res.ok) {
    // The trial tier 403s past ~100/day rather than 429ing -- either way,
    // this is a "fall back to the label camera" situation, not an error.
    console.warn(`[upc] lookup returned ${res.status}`);
    return null;
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    console.warn('[upc] lookup returned non-JSON body');
    return null;
  }

  const items = (body as { items?: unknown[] })?.items;
  if (!Array.isArray(items) || items.length === 0) {
    console.log('[upc] no match', { digits, code: (body as { code?: string })?.code });
    return null;
  }

  const first = items[0] as Record<string, unknown>;
  const title = typeof first.title === 'string' ? first.title : null;
  if (!title) {
    console.warn('[upc] matched item had no usable title', JSON.stringify(first).slice(0, 300));
    return null;
  }

  return {
    title,
    brand: typeof first.brand === 'string' ? first.brand : null,
    upc: digits,
  };
}
