import { NextResponse } from 'next/server';
import { createClient, getUser } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: 'Sign in to delete cards.' }, { status: 401 });

  const { id } = await params;
  const supabase = await createClient();

  // The .eq('user_id') is redundant with RLS and kept deliberately: defence in
  // depth costs nothing here, and it means a policy misconfiguration cannot
  // silently turn into a cross-user delete.
  const { error } = await supabase.from('decision_cards').delete().eq('id', id).eq('user_id', user.id);

  if (error) return NextResponse.json({ error: 'Could not delete that card.' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
