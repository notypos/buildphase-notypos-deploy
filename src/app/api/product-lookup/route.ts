import { NextResponse } from 'next/server';
import { z } from 'zod';
import { lookupUpc } from '@/lib/upc/lookup';
import { searchDsldByName, getDsldLabel, pickBestMatch } from '@/lib/dsld/client';
import { trackedNutrientKeys } from '@/lib/nih/stack-check';
import { canonicalNutrient } from '@/lib/nih/units';

export const runtime = 'nodejs';
export const maxDuration = 30;

const BodySchema = z.object({ barcode: z.string().min(6).max(32) });

// Public, like /api/scan: resolving a barcode to a product touches no user
// data -- nothing is saved here, only looked up. Two outbound calls per
// request (UPC lookup, then DSLD), so a slightly tighter window than
// /api/scan's single vision call.
const hits = new Map<string, number[]>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 10;

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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "That barcode doesn't look valid." }, { status: 400 });
  }

  // Step 1: barcode -> product identity. DSLD has no barcode endpoint of
  // its own (see src/lib/dsld/client.ts) -- this is the missing link.
  const upcProduct = await lookupUpc(parsed.data.barcode);
  if (!upcProduct) {
    return NextResponse.json({
      matched: false,
      reason: 'no_upc_match',
      message: "We couldn't identify that barcode. Try photographing the Supplement Facts panel instead.",
    });
  }

  // Step 2: product identity -> NIH's own record for it, so what gets shown
  // is the manufacturer-submitted label on file with NIH, not a guess.
  const dsldHits = await searchDsldByName(upcProduct.title);
  const best = pickBestMatch(dsldHits, upcProduct.brand);
  if (!best) {
    return NextResponse.json({
      matched: false,
      reason: 'no_dsld_match',
      upcProduct,
      message: `We found "${upcProduct.title}" but it's not in NIH's supplement database yet. Try photographing the label instead.`,
    });
  }

  const label = await getDsldLabel(best.id);
  if (!label) {
    return NextResponse.json({
      matched: false,
      reason: 'no_dsld_match',
      upcProduct,
      message: `We found "${upcProduct.title}" but couldn't load its NIH record. Try photographing the label instead.`,
    });
  }

  // Same "will the dose-safety check actually be able to use this row"
  // signal /api/scan attaches to vision-read rows -- a lookup failure here
  // shouldn't sink an otherwise-successful match.
  let tracked = new Set<string>();
  try {
    tracked = await trackedNutrientKeys();
  } catch (err) {
    console.warn('[product-lookup] nutrient_limits lookup failed', err instanceof Error ? err.message : err);
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
}
