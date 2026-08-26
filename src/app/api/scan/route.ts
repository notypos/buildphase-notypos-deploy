import { NextResponse } from 'next/server';
import { scanLabelImage } from '@/lib/vision/scan-label';
import { trackedNutrientKeys } from '@/lib/nih/stack-check';
import { canonicalNutrient } from '@/lib/nih/units';
import { LlmError } from '@/lib/llm';

export const runtime = 'nodejs';
export const maxDuration = 60;

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB — well under Vercel's request body limit once encoded

// Reading a label doesn't touch anyone's data — no sign-in required, so
// judges/visitors can try it without an account. Saving a result to My Stack
// (client-side, direct to Supabase) still requires sign-in, enforced there.
// Rate limiting is the only abuse guard on this route.
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
    return NextResponse.json(
      { error: 'Too many scans in a row. Give it a minute.' },
      { status: 429 },
    );
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
    const scanned = await scanLabelImage(file.type, base64);

    // Tag each row with whether NIH publishes any limit data for it at all,
    // so the UI can say up front which items the dose-safety check will
    // actually be able to use — not just after adding to My Stack. A lookup
    // failure here shouldn't sink an otherwise-successful scan, so items
    // just come back untagged (nihTracked: false) if it errors.
    let tracked = new Set<string>();
    try {
      tracked = await trackedNutrientKeys();
    } catch (lookupErr) {
      console.warn('[scan] nutrient_limits lookup failed', lookupErr instanceof Error ? lookupErr.message : lookupErr);
    }
    const items = scanned.items.map((item) => ({
      ...item,
      nihTracked: tracked.has(canonicalNutrient(item.labelName)),
    }));

    return NextResponse.json({ ...scanned, items });
  } catch (err) {
    if (err instanceof LlmError) {
      console.error(`[scan] ${err.message}`);
      return NextResponse.json({ error: err.userMessage }, { status: err.status ?? 502 });
    }
    // Deliberately does not log image bytes.
    console.error('[scan] unexpected', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json(
      { error: 'Could not read that label. Try again with better lighting.' },
      { status: 500 },
    );
  }
}
