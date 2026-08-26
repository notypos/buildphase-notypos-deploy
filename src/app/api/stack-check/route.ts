import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, getUser } from '@/lib/supabase/server';
import { checkStack, type StackEntry } from '@/lib/nih/stack-check';

export const runtime = 'nodejs';
export const maxDuration = 30;

// Same session-only health context as /api/ask. ageYears is required here
// (not nullable) because the dose-safety check has to pick one NIH life-stage
// row — there is no "general" comparison to fall back to the way there is
// for an Ask answer.
const BodySchema = z.object({
  ageYears: z.number().int().min(0).max(120),
  sex: z.enum(['female', 'male']).nullable(),
  pregnant: z.boolean(),
  breastfeeding: z.boolean(),
});

interface StackItemRow {
  label_name: string;
  supplement: string | null;
  dose_amount: number | null;
  dose_unit: string | null;
  ingredients: { nutrient: string; amount: number; unit: string }[] | null;
}

/** Run the dose-safety check across everything the signed-in user has saved. */
export async function POST(request: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: 'Sign in to check your stack.' }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Enter your age to run this check.' }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('stack_items')
    .select('label_name, supplement, dose_amount, dose_unit, ingredients');

  if (error) {
    console.error('[stack-check] load failed:', error.message);
    return NextResponse.json({ error: 'Could not load your stack.' }, { status: 500 });
  }

  const rows = (data ?? []) as StackItemRow[];
  const entries: StackEntry[] = rows.map((r) => ({
    labelName: r.label_name,
    supplement: r.supplement,
    doseAmount: r.dose_amount,
    doseUnit: r.dose_unit,
    ingredients: r.ingredients,
  }));

  try {
    const findings = await checkStack(entries, {
      ageYears: parsed.data.ageYears,
      sex: parsed.data.sex ?? undefined,
      pregnant: parsed.data.pregnant,
      breastfeeding: parsed.data.breastfeeding,
    });
    return NextResponse.json({ findings, itemCount: entries.length });
  } catch (err) {
    console.error('[stack-check] check failed:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Could not run the check. Try again.' }, { status: 500 });
  }
}
