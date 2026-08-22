import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, getUser } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const GuidanceSchema = z.object({
  evidence: z.string(),
  uncertainty: z.string(),
  marketing: z.string(),
  forYou: z.string().optional(),
  healthConsiderations: z.string().optional(),
  medicationInteractions: z.string().optional(),
});

const CitationSchema = z.object({
  index: z.number(),
  indices: z.array(z.number()),
  supplement: z.string(),
  section: z.string().nullable(),
  subsection: z.string().nullable().optional(),
  slug: z.string(),
  url: z.string(),
});

const BodySchema = z.object({
  title: z.string().min(1).max(160),
  question: z.string().max(500),
  guidance: GuidanceSchema,
  citations: z.array(CitationSchema).max(30),
  questionsForClinician: z.array(z.string().max(300)).max(6).optional(),
});

/** List the signed-in user's saved cards. RLS also enforces ownership. */
export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: 'Sign in to see saved cards.' }, { status: 401 });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('decision_cards')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: 'Could not load your cards.' }, { status: 500 });
  return NextResponse.json({ cards: data ?? [] });
}

export async function POST(request: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: 'Sign in to save cards.' }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'That card could not be saved.' }, { status: 400 });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('decision_cards')
    .insert({
      user_id: user.id,
      title: parsed.data.title,
      question: parsed.data.question,
      guidance: parsed.data.guidance,
      citations: parsed.data.citations,
      questions_for_clinician: parsed.data.questionsForClinician ?? [],
      // Vestigial: medications are never collected, so this is always false.
      includes_medications: false,
    })
    .select('id')
    .single();

  if (error) {
    console.error('[cards] insert failed:', error.message);
    return NextResponse.json({ error: 'Could not save that card.' }, { status: 500 });
  }
  return NextResponse.json({ id: data.id }, { status: 201 });
}
