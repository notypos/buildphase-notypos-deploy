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
    <main className="mx-auto min-h-screen max-w-7xl px-5 py-8 md:px-8 md:py-12">
      <div className="mb-8 flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
        <div>
          <p className="mb-3 text-sm font-semibold text-clear-verified">Deterministic nutrient checks</p>
          <h1 className="text-3xl font-bold text-white md:text-5xl">My Stack</h1>
          <p className="mt-3 max-w-3xl text-base leading-relaxed text-slate-300">
            Track your supplements, see overlapping nutrients, and compare totals against NIH upper
            limits for your age, sex, and life stage.
          </p>
        </div>
        <p className="rounded-lg border border-violet-300/25 bg-violet-300/[0.08] px-4 py-3 text-sm leading-relaxed text-violet-50 lg:max-w-sm">
          The LLM does not calculate totals, duplicate ingredients, percentages, or upper-limit
          comparisons.
        </p>
      </div>

      <StackTabs items={items ?? []} medications={medications ?? []} />

      <section className="mb-6 rounded-lg border border-white/10 bg-white/[0.04] p-5">
        <h2 className="mb-3 text-base font-bold text-white">
          Saved Decision Cards ({cards?.length ?? 0})
        </h2>
        {cards?.length ? (
          <ul className="space-y-2 text-sm text-slate-300">
            {cards.map((c) => (
              <li key={c.id} className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2">
                {c.title}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">None saved yet.</p>
        )}
      </section>

      <p className="rounded-lg border border-teal-300/20 bg-teal-300/[0.08] p-5 text-sm leading-relaxed text-teal-50">
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
