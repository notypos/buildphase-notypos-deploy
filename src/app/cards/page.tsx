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
    <main className="mx-auto min-h-screen max-w-5xl px-5 py-8 md:px-8 md:py-12">
      <div className="mb-8">
        <p className="mb-3 text-sm font-semibold text-clear-verified">Shareable evidence summaries</p>
        <h1 className="text-3xl font-bold text-white md:text-5xl">Saved cards</h1>
        <p className="mt-3 max-w-3xl text-base leading-relaxed text-slate-300">
          Answers you chose to keep, with their NIH sources. Print one to bring to an appointment.
        </p>
      </div>

      {cards?.length ? (
        <CardList cards={cards} />
      ) : (
        <div className="rounded-lg border border-dashed border-white/[0.15] bg-white/[0.04] p-8 text-center">
          <p className="text-slate-300">Nothing saved yet.</p>
          <Link href="/ask" className="mt-3 inline-block rounded-md border border-teal-300/25 bg-teal-300/10 px-4 py-2 font-semibold text-teal-100 hover:border-teal-200/50">
            Ask a question
          </Link>
        </div>
      )}
    </main>
  );
}
