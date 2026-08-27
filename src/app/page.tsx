import Image from 'next/image';
import Link from 'next/link';

const examples = ['Magnesium benefits', 'Ashwagandha for stress', 'Vitamin D dosage'];

const steps = [
  ['1', 'Scan or search', 'Find a real supplement label or ask about an ingredient.'],
  ['2', 'We find the facts', 'Match ingredients and questions to NIH evidence sources.'],
  ['3', 'Get clear answers', 'Separate evidence, uncertainty, safety, and marketing claims.'],
  ['4', 'Build your stack', 'Track overlapping nutrients and run deterministic limit checks.'],
] as const;

const evidencePanels = [
  ['NIH Evidence', 'ODS and NCCIH fact sheets'],
  ['RDA / AI', 'Age, sex, and life-stage values'],
  ['Safety', 'Upper limits and cautions'],
  ["What's Not Known", 'Uncertainty stays visible'],
] as const;

export default function Home() {
  return (
    <main className="min-h-screen">
      <section className="mx-auto grid max-w-7xl gap-10 px-5 pb-12 pt-10 md:grid-cols-[1fr_0.9fr] md:px-8 md:pb-16 md:pt-16">
        <div className="flex flex-col justify-center">
          <p className="mb-4 inline-flex w-fit items-center gap-2 rounded-full border border-teal-300/25 bg-teal-300/10 px-3 py-1.5 text-sm font-semibold text-teal-100">
            <span className="h-1.5 w-1.5 rounded-full bg-clear-verified" />
            Scan the label. Ask NIH Evidence.
          </p>
          <h1 className="max-w-3xl text-4xl font-bold leading-[1.05] text-white md:text-6xl">
            See what NIH actually knows{' '}
            <span className="bg-gradient-to-r from-violet-200 via-violet-100 to-teal-100 bg-clip-text text-transparent">
              about supplements.
            </span>
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-slate-300">
            Clear answers. Real evidence. No hype. ClearLabel helps you connect a supplement
            question, product label, or stack total to NIH-backed sources.
          </p>

          <form
            action="/ask"
            method="get"
            className="mt-8 max-w-2xl rounded-lg border border-white/10 bg-white/[0.04] p-4 shadow-2xl shadow-black/20"
          >
            <label htmlFor="home-ask" className="mb-3 block text-sm font-semibold text-slate-200">
              Ask NIH Evidence
            </label>
            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                id="home-ask"
                name="q"
                type="search"
                placeholder="e.g. How much magnesium should I take at age 67?"
                className="min-h-12 flex-1 rounded-md border border-white/10 bg-[#081221] px-4 text-base text-white outline-none transition placeholder:text-slate-600 focus:border-violet-300/55 focus:ring-2 focus:ring-violet-400/20"
              />
              <button
                type="submit"
                className="min-h-12 rounded-md bg-gradient-to-r from-[#7557f8] to-[#32d1b0] px-5 font-semibold text-white transition hover:brightness-110"
              >
                Ask NIH Evidence
              </button>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {examples.map((example) => (
                <Link
                  key={example}
                  href={{ pathname: '/ask', query: { q: example } }}
                  className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:border-violet-300/40 hover:text-white"
                >
                  {example}
                </Link>
              ))}
            </div>
          </form>
        </div>

        <div className="relative min-h-[30rem] overflow-hidden rounded-lg border border-white/10 bg-[#0b1424] p-5 shadow-2xl shadow-black/30">
          <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(143,108,255,0.14),transparent_34%,rgba(59,211,173,0.1))]" />
          <div className="relative grid h-full grid-cols-[0.8fr_1fr] gap-4">
            <div className="flex flex-col justify-center gap-3">
              {evidencePanels.map(([title, detail]) => (
                <div key={title} className="rounded-lg border border-white/10 bg-white/[0.05] p-4">
                  <p className="text-sm font-semibold text-white">{title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-400">{detail}</p>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-center">
              <div className="relative w-full max-w-xs">
                <div className="mx-auto h-72 w-36 rounded-b-lg rounded-t-[2rem] border border-white/[0.12] bg-gradient-to-b from-slate-100 to-slate-300 p-3 shadow-2xl shadow-black/30">
                  <div className="h-8 rounded-md bg-slate-900" />
                  <div className="mt-4 rounded-lg border-2 border-slate-950 bg-white p-3 text-slate-950">
                    <p className="text-xs font-bold">Supplement Facts</p>
                    <div className="mt-2 h-0.5 bg-slate-950" />
                    <div className="mt-2 space-y-1 text-[0.58rem]">
                      <div className="flex justify-between gap-2">
                        <span>Magnesium</span>
                        <span>250 mg</span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span>Vitamin D</span>
                        <span>25 mcg</span>
                      </div>
                    </div>
                    <div className="mt-3 h-0.5 bg-slate-950" />
                    <p className="mt-2 text-[0.52rem] leading-tight">According to the product label</p>
                  </div>
                </div>
                <div className="absolute -right-2 bottom-8 rounded-full border border-teal-200/40 bg-teal-200 px-3 py-1.5 text-xs font-bold text-teal-950 shadow-lg shadow-teal-950/30">
                  DSLD found
                </div>
                <div className="absolute -left-3 top-8 flex h-14 w-14 items-center justify-center rounded-full border border-violet-200/[0.35] bg-violet-200 text-lg font-bold text-violet-950 shadow-lg shadow-violet-950/30">
                  NIH
                </div>
                <Image
                  src="/icon-512.png"
                  alt=""
                  width={72}
                  height={72}
                  className="absolute right-8 top-0 rounded-lg border border-white/10 bg-white/10 p-2"
                  priority
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-white/10 bg-white/[0.025]">
        <div className="mx-auto max-w-7xl px-5 py-10 md:px-8">
          <div className="mb-6 flex flex-col justify-between gap-3 md:flex-row md:items-end">
            <div>
              <p className="text-sm font-semibold text-clear-verified">How ClearLabel works</p>
              <h2 className="mt-2 text-2xl font-bold text-white md:text-3xl">From bottle to evidence card.</h2>
            </div>
            <Link
              href="/scan"
              className="inline-flex w-fit rounded-md border border-violet-300/25 bg-violet-300/10 px-4 py-2 text-sm font-semibold text-violet-100 transition hover:border-violet-200/50 hover:bg-violet-300/[0.15]"
            >
              Start with a scan
            </Link>
          </div>
          <div className="grid gap-3 md:grid-cols-4">
            {steps.map(([number, title, detail]) => (
              <article
                key={title}
                className="rounded-lg border border-white/10 bg-[#111d2c]/80 p-5 transition hover:-translate-y-0.5 hover:border-violet-300/30"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-md border border-violet-300/25 bg-violet-300/10 text-sm font-bold text-violet-100">
                  {number}
                </span>
                <h3 className="mt-4 text-base font-semibold text-white">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">{detail}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-5 px-5 py-10 md:grid-cols-3 md:px-8 md:py-12">
        <div className="rounded-lg border border-teal-300/20 bg-teal-300/[0.08] p-5">
          <p className="text-sm font-semibold text-teal-100">Product labels stay labeled</p>
          <p className="mt-2 text-sm leading-relaxed text-slate-300">
            DSLD product data is presented as manufacturer label information, not as NIH endorsement.
          </p>
        </div>
        <div className="rounded-lg border border-violet-300/20 bg-violet-300/[0.08] p-5">
          <p className="text-sm font-semibold text-violet-100">ODS evidence stays separate</p>
          <p className="mt-2 text-sm leading-relaxed text-slate-300">
            Answers distinguish what NIH establishes from what remains uncertain or unstudied.
          </p>
        </div>
        <div className="rounded-lg border border-amber-300/25 bg-amber-300/[0.08] p-5">
          <p className="text-sm font-semibold text-amber-100">Stack math is deterministic</p>
          <p className="mt-2 text-sm leading-relaxed text-slate-300">
            Code handles nutrient totals and upper-limit comparisons before AI explains the result.
          </p>
        </div>
      </section>
    </main>
  );
}
