import Link from 'next/link';
import { createClient, getUser } from '@/lib/supabase/server';
import CardList from '@/components/CardList';

export const metadata = { title: 'Saved cards — ClearLabel' };

export default async function CardsPage() {
  // Middleware redirects anonymous users, but a page reading user data should
  // not rely on middleware alone for its authorization.
  const user = await getUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data: cards } = await supabase
    .from('decision_cards')
    .select('*')
    .order('created_at', { ascending: false });

  return (
    <main className="mx-auto max-w-3xl px-5 py-10">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">Saved cards</h1>
      <p className="mt-1 mb-8 text-slate-600">
        Answers you chose to keep, with their NIH sources. Print one to bring to an appointment.
      </p>

      {cards?.length ? (
        <CardList cards={cards} />
      ) : (
        <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center">
          <p className="text-slate-600">Nothing saved yet.</p>
          <Link href="/" className="mt-2 inline-block font-medium text-teal-700 hover:underline">
            Ask a question →
          </Link>
        </div>
      )}
    </main>
  );
}
