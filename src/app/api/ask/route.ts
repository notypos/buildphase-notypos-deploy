import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ask, AUDIENCES } from '@/lib/rag/answer';
import { LlmError } from '@/lib/llm';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Session-only health context: age, sex, and life stage only — what NIH
// reference tables are keyed to. Accepted, used for this request, never
// persisted and never logged. Conditions and medications are deliberately not
// collected at all.
const HealthContextSchema = z.object({
  ageYears: z.number().int().min(0).max(120).nullable(),
  sex: z.enum(['female', 'male']).nullable(),
  pregnant: z.boolean(),
  breastfeeding: z.boolean(),
});

const BodySchema = z.object({
  question: z.string().min(3).max(500),
  audience: z.enum(AUDIENCES).default('standard'),
  language: z.enum(['en', 'es']).default('en'),
  healthContext: HealthContextSchema.optional(),
});

// Simple in-memory limiter. Fine for one Vercel instance and for the demo;
// swap for Upstash Redis before this matters.
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
    return NextResponse.json(
      { error: 'Too many questions in a row. Give it a minute.' },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Ask a question between 3 and 500 characters.' },
      { status: 400 },
    );
  }

  try {
    const result = await ask(parsed.data.question, {
      audience: parsed.data.audience,
      language: parsed.data.language,
      healthContext: parsed.data.healthContext,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof LlmError) {
      console.error(`[ask] ${err.message}`);
      return NextResponse.json({ error: err.userMessage }, { status: err.status ?? 502 });
    }
    // Deliberately does not log the request body: it may carry conditions and
    // medications, and "we don't store health data" has to include the logs.
    console.error('[ask] unexpected', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json(
      { error: 'Something went wrong on our side. Try again.' },
      { status: 500 },
    );
  }
}
