import { getUser } from '@/lib/supabase/server';
import { createClient } from '@/lib/supabase/server';
import AddStackItemForm from '@/components/AddStackItemForm';
import DeleteStackItemButton from '@/components/DeleteStackItemButton';

export default async function StackPage() {
  // Middleware already redirects anonymous users, but a page that reads user
  // data should not depend on middleware alone for its authorization.
  const user = await getUser();
  if (!user) return null;

  const supabase = await createClient();
  // Medications are deliberately absent: they are a session input, never stored.
  const [{ data: items }, { data: cards }] = await Promise.all([
    supabase.from('stack_items').select('*').order('created_at', { ascending: false }),
    supabase.from('decision_cards').select('id, title, created_at').order('created_at', { ascending: false }),
  ]);

  return (
    <main className="mx-auto max-w-3xl px-5 py-10">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">My Stack</h1>
      <p className="mt-1 mb-8 text-slate-600">
        What you take, checked against NIH upper limits and interaction guidance.
      </p>

      <section className="mb-6 rounded-xl border border-slate-200 p-5">
        <h2 className="mb-3 text-xs font-bold tracking-wide text-slate-500 uppercase">
          Supplements ({items?.length ?? 0})
        </h2>
        {items?.length ? (
          <ul className="mb-4 space-y-1.5 text-sm text-slate-700">
            {items.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-2">
                <span>
                  {i.label_name}
                  {i.dose_amount && ` — ${i.dose_amount} ${i.dose_unit ?? ''}`}
                </span>
                <DeleteStackItemButton id={i.id} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="mb-4 text-sm text-slate-500">Nothing saved yet.</p>
        )}
        <AddStackItemForm />
      </section>

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
        <span className="font-semibold">Your health details are never saved.</span> Age, sex,
        and pregnancy status stay in your browser tab and are used only for the answers you
        request. We never ask for health conditions or medications at all — when a NIH fact
        sheet discusses a condition or a drug interaction, that shows up in the answer itself.
        Only the supplements above and cards you explicitly save are stored.
      </p>
      <p className="mt-3 text-sm text-slate-500">
        Signed in as <span className="font-medium">{user.email}</span>.
      </p>
    </main>
  );
}
