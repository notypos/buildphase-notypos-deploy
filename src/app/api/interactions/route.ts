import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, getUser } from '@/lib/supabase/server';
import { checkInteractions } from '@/lib/rag/interactions';
import { LlmError } from '@/lib/llm';

export const runtime = 'nodejs';
export const maxDuration = 60;

const BodySchema = z.object({
  supplementNames: z.array(z.string().min(1).max(100)).min(1).max(10),
  medicationIds: z.array(z.string().uuid()).min(1).max(10),
});

// Heavier than /api/ask (one retrieval pass per supplement, plus generation)
// so the window is tighter.
const hits = new Map<string, number[]>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 5;

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > MAX_PER_WINDOW;
}

export async function POST(request: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: 'Sign in to check interactions.' }, { status: 401 });

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  if (rateLimited(ip)) {
    return NextResponse.json({ error: 'Too many checks in a row. Give it a minute.' }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Enter 1-10 supplement names and select at least one medication.' },
      { status: 400 },
    );
  }

  // Medications are looked up by id, scoped by RLS to this user — never trust
  // client-supplied names for what's actually on someone's medication list.
  const supabase = await createClient();
  const { data: meds, error: medsError } = await supabase
    .from('medications')
    .select('id, name')
    .in('id', parsed.data.medicationIds);

  if (medsError) {
    return NextResponse.json({ error: 'Could not load your medications.' }, { status: 500 });
  }
  if (!meds || meds.length === 0) {
    return NextResponse.json({ error: 'Select at least one medication.' }, { status: 400 });
  }

  try {
    const result = await checkInteractions(
      parsed.data.supplementNames,
      meds.map((m) => m.name),
    );
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof LlmError) {
      console.error(`[interactions] ${err.message}`);
      return NextResponse.json({ error: err.userMessage }, { status: err.status ?? 502 });
    }
    console.error('[interactions] unexpected', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json({ error: 'Could not run the check. Try again.' }, { status: 500 });
  }
}
