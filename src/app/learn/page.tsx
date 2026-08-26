import Link from 'next/link';

const topics = [
  'Vitamin D',
  'Magnesium',
  'Calcium',
  'Iron',
  'Creatine',
  'Vitamin B12',
  'Omega-3s',
  'Zinc',
];

const sections = ['Recommended intake', 'Safety', 'Interactions', 'Health evidence'];

export const metadata = { title: 'Learn - ClearLabel supplement topics' };

export default function LearnPage() {
  return (
    <main className="mx-auto min-h-screen max-w-7xl px-5 py-8 md:px-8 md:py-12">
      <div className="mb-8">
        <p className="mb-3 text-sm font-semibold text-clear-verified">Browse NIH-backed topics</p>
        <h1 className="text-3xl font-bold text-white md:text-5xl">Learn</h1>
        <p className="mt-3 max-w-3xl text-base leading-relaxed text-slate-300">
          Start with a common supplement topic, then open a ClearLabel evidence view grounded in
          NIH fact sheets.
        </p>
      </div>

      <div className="mb-8 rounded-lg border border-white/10 bg-white/[0.04] p-4">
        <form action="/ask" method="get" className="flex flex-col gap-3 sm:flex-row">
          <label htmlFor="learn-search" className="sr-only">
            Search supplement topics
          </label>
          <input
            id="learn-search"
            name="q"
            type="search"
            placeholder="Search a supplement topic..."
            className="min-h-12 flex-1 rounded-md border border-white/10 bg-[#081221] px-4 text-white outline-none transition placeholder:text-slate-600 focus:border-violet-300/55 focus:ring-2 focus:ring-violet-400/20"
          />
          <button
            type="submit"
            className="rounded-md bg-gradient-to-r from-[#7557f8] to-[#32d1b0] px-5 font-semibold text-white transition hover:brightness-110"
          >
            Ask
          </button>
        </form>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {topics.map((topic) => (
          <article
            key={topic}
            className="rounded-lg border border-white/10 bg-[#111d2c]/[0.85] p-5 transition hover:-translate-y-0.5 hover:border-violet-300/30"
          >
            <h2 className="text-lg font-bold text-white">{topic}</h2>
            <div className="mt-4 flex flex-wrap gap-2">
              {sections.map((section) => (
                <span
                  key={section}
                  className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs text-slate-400"
                >
                  {section}
                </span>
              ))}
            </div>
            <Link
              href={{ pathname: '/ask', query: { q: `What does NIH say about ${topic}?` } }}
              className="mt-5 inline-flex rounded-md border border-teal-300/25 bg-teal-300/10 px-3 py-2 text-sm font-semibold text-teal-100 transition hover:border-teal-200/50"
            >
              View NIH evidence
            </Link>
          </article>
        ))}
      </div>
    </main>
  );
}
