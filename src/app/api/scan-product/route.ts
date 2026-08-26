import { NextResponse } from 'next/server';
import { identifyProduct } from '@/lib/vision/identify-product';
import { searchDsldByName, getDsldLabel, pickBestMatch } from '@/lib/dsld/client';
import { trackedNutrientKeys } from '@/lib/nih/stack-check';
import { canonicalNutrient } from '@/lib/nih/units';
import { LlmError } from '@/lib/llm';

export const runtime = 'nodejs';
export const maxDuration = 45; // vision call + DSLD search + label fetch, chained

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const MAX_BYTES = 8 * 1024 * 1024;

// Public, like /api/scan: identifying a product from a photo touches no
// user data. Nothing is saved here, only looked up.
const hits = new Map<string, number[]>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 6;

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > MAX_PER_WINDOW;
}

export async function POST(req: Request) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  if (rateLimited(ip)) {
    return NextResponse.json({ error: 'Too many scans in a row. Give it a minute.' }, { status: 429 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Send the photo as multipart form data.' }, { status: 400 });
  }

  const file = form.get('image');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No image found in the request.' }, { status: 400 });
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: 'Use a JPEG, PNG, WEBP, or HEIC photo.' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'That photo is too large — try a smaller one.' }, { status: 400 });
  }

  try {
    const bytes = await file.arrayBuffer();
    const base64 = Buffer.from(bytes).toString('base64');

    // Step 1: photo -> product identity (brand + product name).
    const identified = await identifyProduct(file.type, base64);
    if (!identified.readable || (!identified.brandName && !identified.productName)) {
      return NextResponse.json({
        matched: false,
        reason: 'not_recognized',
        message: "We couldn't identify a product in that photo. Try the Supplement Facts panel instead.",
      });
    }

    // Step 2: product identity -> NIH's own record for it, so what gets
    // shown is the manufacturer-submitted label on file, not a guess.
    const query = [identified.brandName, identified.productName].filter(Boolean).join(' ');
    const dsldHits = await searchDsldByName(query);
    const best = pickBestMatch(dsldHits, identified.brandName);
    if (!best) {
      return NextResponse.json({
        matched: false,
        reason: 'no_dsld_match',
        identified: { brandName: identified.brandName, productName: identified.productName },
        message: `We recognized "${query}" but it's not in NIH's supplement database yet. Try the Supplement Facts panel instead.`,
      });
    }

    const label = await getDsldLabel(best.id);
    if (!label) {
      return NextResponse.json({
        matched: false,
        reason: 'no_dsld_match',
        identified: { brandName: identified.brandName, productName: identified.productName },
        message: `We recognized "${query}" but couldn't load its NIH record. Try the Supplement Facts panel instead.`,
      });
    }

    let tracked = new Set<string>();
    try {
      tracked = await trackedNutrientKeys();
    } catch (err) {
      console.warn('[scan-product] nutrient_limits lookup failed', err instanceof Error ? err.message : err);
    }

    return NextResponse.json({
      matched: true,
      dsldId: label.id,
      productName: label.fullName,
      brandName: label.brandName,
      items: label.ingredients.map((ing) => ({
        labelName: ing.name,
        doseAmount: ing.amount,
        doseUnit: ing.unit,
        nihTracked: tracked.has(canonicalNutrient(ing.name)),
      })),
    });
  } catch (err) {
    if (err instanceof LlmError) {
      console.error(`[scan-product] ${err.message}`);
      return NextResponse.json({ error: err.userMessage }, { status: err.status ?? 502 });
    }
    console.error('[scan-product] unexpected', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json(
      { error: 'Could not identify that product. Try again.' },
      { status: 500 },
    );
  }
}
