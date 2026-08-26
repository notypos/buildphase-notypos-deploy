import { getUser } from '@/lib/supabase/server';
import { createClient } from '@/lib/supabase/server';
import StackTabs from '@/components/StackTabs';

export default async function StackPage() {
  // Middleware already redirects anonymous users, but a page that reads user
  // data should not depend on middleware alone for its authorization.
  const user = await getUser();
  if (!user) return null;

  const supabase = await createClient();
  const [{ data: items }, { data: cards }, { data: medications }] = await Promise.all([
    supabase.from('stack_items').select('*').order('created_at', { ascending: false }),
    supabase.from('decision_cards').select('id, title, created_at').order('created_at', { ascending: false }),
    supabase.from('medications').select('id, name').order('created_at', { ascending: false }),
  ]);

  return (
    <main className="mx-auto max-w-3xl px-5 py-10">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">My Stack</h1>
      <p className="mt-1 mb-8 text-slate-600">
        Add what you take here so they get checked together — not one at a time. Two supplements
        can each be fine alone but go over an NIH limit combined.
      </p>

      <StackTabs items={items ?? []} medications={medications ?? []} />

      <section className="mb-6 rounded-xl border border-slate-200 p-5">
        <h2 className="mb-3 text-xs font-bold tracking-wide text-slate-500 uppercase">
          Saved Decision Cards ({cards?.length ?? 0})
        </h2>
        {cards?.length ? (
          <ul className="space-y-1 text-sm text-slate-700">
            {cards.map((c) => (
              <li key={c.id}>{c.title}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">None saved yet.</p>
        )}
      </section>

      <p className="rounded-xl bg-teal-50 p-5 text-sm text-teal-900">
        <span className="font-semibold">What&apos;s saved, and why.</span> Age, sex, and pregnancy
        status stay in your browser tab only — never saved. Supplements, medications you add for
        the interaction check, and cards you explicitly save are stored to your account. We still
        never ask about health conditions; when a NIH fact sheet discusses one, that shows up in
        the answer itself.
      </p>
      <p className="mt-3 text-sm text-slate-500">
        Signed in as <span className="font-medium">{user.email}</span>.
      </p>
    </main>
  );
}
