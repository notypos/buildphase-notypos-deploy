'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import HealthContextPanel from '@/components/HealthContextPanel';
import { createClient } from '@/lib/supabase/client';
import { storeAnswer, loadAnswer, markSaved, clearAnswer } from '@/lib/last-answer';
import { agencyShort } from '@/lib/rag/sources';
import {
  EMPTY_CONTEXT,
  loadContext,
  saveContext,
  clearContext,
  defaultReadingLevel,
  hasAnyContext,
  summarize,
  type HealthContext,
} from '@/lib/health-context';

const READING_LEVELS = [
  { id: 'simple', label: 'Simple', hint: 'Shorter sentences, everyday words' },
  { id: 'standard', label: 'Standard', hint: 'Normal adult reading level' },
] as const;

const EXAMPLES = [
  'How much magnesium should I get at age 67?',
  'Does ashwagandha actually reduce stress?',
  'Is a supplement claim about better sleep supported?',
];

interface Citation {
  index: number;
  indices: number[];
  supplement: string;
  section: string | null;
  url: string;
}

interface AskResult {
  answer: {
    evidence: string;
    uncertainty: string;
    marketing: string;
    forYou?: string;
    healthConsiderations?: string;
    medicationInteractions?: string;
    questionsForClinician?: string[];
    citationsUsed: number[];
  } | null;
  citations: Citation[];
  refused: boolean;
  refusalReason?: string;
  topSimilarity: number;
}

type EvidenceTone = 'profile' | 'evidence' | 'uncertainty' | 'marketing' | 'considerations' | 'interactions';

function withMarkers(text: string) {
  return text.split(/(\[\d+\])/g).map((part, i) => {
    const m = part.match(/^\[(\d+)\]$/);
    if (!m) return <span key={i}>{part}</span>;
    return (
      <sup
        key={i}
        className="ml-1 rounded bg-violet-300/[0.15] px-1.5 py-0.5 text-[0.65rem] font-semibold text-violet-100 ring-1 ring-violet-300/25"
      >
        {m[1]}
      </sup>
    );
  });
}

function EvidenceCard({
  title,
  tone,
  children,
}: {
  title: string;
  tone: EvidenceTone;
  children: React.ReactNode;
}) {
  const tones: Record<EvidenceTone, string> = {
    profile: 'border-slate-500/20 bg-slate-200/[0.08] text-slate-100',
    evidence: 'border-teal-300/20 bg-teal-300/[0.08] text-teal-50',
    uncertainty: 'border-sky-300/20 bg-sky-300/[0.08] text-sky-50',
    marketing: 'border-amber-300/25 bg-amber-300/[0.08] text-amber-50',
    considerations: 'border-violet-300/20 bg-violet-300/[0.08] text-violet-50',
    interactions: 'border-rose-300/20 bg-rose-300/[0.08] text-rose-50',
  };

  return (
    <section className={`rounded-lg border p-5 ${tones[tone]}`}>
      <h3 className="mb-2 text-sm font-semibold text-white">{title}</h3>
      <div className="space-y-2 whitespace-pre-line text-[0.95rem] leading-relaxed text-slate-200">{children}</div>
    </section>
  );
}

export default function AskExperience({
  initialQuestion = '',
}: {
  initialQuestion?: string;
}) {
  const [question, setQuestion] = useState(initialQuestion);
  const [context, setContext] = useState<HealthContext>(EMPTY_CONTEXT);
  const [levelOverride, setLevelOverride] = useState<string | null>(null);
  const language: 'en' | 'es' = 'en';
  const [result, setResult] = useState<AskResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [asked, setAsked] = useState('');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setContext(loadContext());

      if (initialQuestion.trim()) return;

      const stored = loadAnswer();
      if (stored) {
        setResult(stored.result as AskResult);
        setQuestion(stored.question);
        setAsked(stored.question);
        if (stored.savedCardId) setSaveState('saved');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [initialQuestion]);

  useEffect(() => {
    createClient()
      .auth.getUser()
      .then(({ data }) => setSignedIn(!!data.user))
      .catch(() => setSignedIn(false));
  }, []);

  function reset() {
    clearAnswer();
    setResult(null);
    setQuestion('');
    setAsked('');
    setError(null);
    setSaveState('idle');
  }

  async function saveCard() {
    if (!result?.answer || saveState === 'saving') return;
    setSaveState('saving');
    const { citationsUsed, questionsForClinician, ...guidance } = result.answer;
    void citationsUsed;
    try {
      const res = await fetch('/api/cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: asked.slice(0, 160),
          question: asked,
          guidance,
          citations: result.citations,
          questionsForClinician,
        }),
      });
      if (res.ok) {
        const { id } = await res.json().catch(() => ({ id: '' }));
        if (id) markSaved(id);
        setSaveState('saved');
      } else {
        setSaveState('error');
      }
    } catch {
      setSaveState('error');
    }
  }

  const updateContext = (next: HealthContext) => {
    setContext(next);
    saveContext(next);
  };

  const readingLevel = levelOverride ?? defaultReadingLevel(context.ageYears);

  async function submit(q: string) {
    if (!q.trim() || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setSaveState('idle');
    setAsked(q);
    clearAnswer();
    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: q,
          audience: readingLevel,
          language,
          healthContext: hasAnyContext(context) ? context : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? 'Something went wrong.');
      } else {
        setResult(json);
        storeAnswer(q, json);
      }
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  const a = result?.answer;

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-5 py-8 md:px-8 md:py-12">
      <div className="mb-8 flex flex-col justify-between gap-5 md:flex-row md:items-end">
        <div>
          <p className="mb-3 text-sm font-medium text-clear-verified">NIH evidence workspace</p>
          <h1 className="text-3xl font-bold text-white md:text-5xl">Ask ClearLabel</h1>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-slate-300">
            Ask about a supplement, ingredient, dosage, or label claim. ClearLabel answers from NIH
            fact sheets and keeps uncertainty visible.
          </p>
        </div>
        <Link
          href="/scan"
          className="inline-flex items-center justify-center rounded-md border border-teal-300/25 bg-teal-300/10 px-4 py-2 text-sm font-semibold text-teal-100 transition hover:border-teal-200/50 hover:bg-teal-300/[0.15]"
        >
          Scan a supplement
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.25fr)]">
        <section className="rounded-lg border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/20">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit(question);
            }}
            className="space-y-4"
          >
            <label htmlFor="question" className="block text-sm font-semibold text-slate-200">
              Ask NIH Evidence
            </label>
            <textarea
              id="question"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              rows={7}
              placeholder="Ask a question or paste a supplement label claim..."
              className="w-full resize-none rounded-lg border border-white/10 bg-[#081221] px-4 py-3 text-base text-white outline-none transition placeholder:text-slate-600 focus:border-violet-300/55 focus:ring-2 focus:ring-violet-400/20"
            />

            <div className="space-y-3 rounded-lg border border-white/10 bg-[#07111f]/60 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-slate-300">Reading level</span>
                {READING_LEVELS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setLevelOverride(opt.id)}
                    title={opt.hint}
                    className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                      readingLevel === opt.id
                        ? 'bg-teal-300/[0.18] text-teal-100 ring-1 ring-teal-300/[0.35]'
                        : 'bg-white/5 text-slate-400 hover:bg-white/10 hover:text-slate-100'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
                {levelOverride === null && context.ageYears !== null && (
                  <span className="text-xs text-slate-500">set from your age</span>
                )}
              </div>
              <HealthContextPanel
                value={context}
                onChange={updateContext}
                onClear={() => {
                  clearContext();
                  setContext(EMPTY_CONTEXT);
                }}
              />
            </div>

            <button
              type="submit"
              disabled={loading || !question.trim()}
              className="w-full rounded-md bg-gradient-to-r from-[#7557f8] to-[#32d1b0] px-5 py-3 font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {loading ? 'Building your Evidence Card...' : 'Ask NIH Evidence'}
            </button>
          </form>

          <div className="mt-5 flex flex-wrap gap-2">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => setQuestion(ex)}
                className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:border-violet-300/40 hover:text-white"
              >
                {ex}
              </button>
            ))}
          </div>
        </section>

        <section className="min-h-[30rem]">
          {!loading && !error && !result && (
            <div className="flex h-full min-h-[30rem] flex-col justify-center rounded-lg border border-white/10 bg-white/[0.03] p-6">
              <p className="text-sm font-semibold text-clear-verified">Ready when you are</p>
              <h2 className="mt-3 text-2xl font-bold text-white">Evidence, uncertainty, and sources stay separated.</h2>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-slate-400">
                Try a nutrient question, paste a label claim, or add age and sex only when NIH
                recommendations differ by those values.
              </p>
            </div>
          )}

          {loading && (
            <div className="space-y-3">
              {['Finding relevant NIH fact sheets...', 'Checking the evidence...', 'Building your Evidence Card...'].map(
                (stage, i) => (
                  <div key={stage} className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
                    <p className="text-sm font-semibold text-slate-200">{stage}</p>
                    <div className="mt-4 h-3 w-full animate-pulse rounded-full bg-white/[0.08]" />
                    <div className="mt-2 h-3 w-2/3 animate-pulse rounded-full bg-white/[0.06]" />
                    <span className="sr-only">Loading step {i + 1}</span>
                  </div>
                ),
              )}
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-300/25 bg-red-300/10 p-5 text-red-100">
              <h3 className="mb-1 text-sm font-bold">Something went wrong</h3>
              <p className="text-[0.95rem]">{error}</p>
            </div>
          )}

          {result?.refused && (
            <div className="rounded-lg border border-amber-300/25 bg-amber-300/10 p-5 text-amber-50">
              <h3 className="mb-2 text-sm font-bold">Not enough NIH evidence</h3>
              <p className="text-[0.95rem] leading-relaxed">{result.refusalReason}</p>
              <button
                type="button"
                onClick={reset}
                className="mt-4 rounded-md border border-white/10 px-3 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/[0.08]"
              >
                Modify the question
              </button>
            </div>
          )}

          {a && (
            <div className="space-y-4">
              <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                  <div>
                    <p className="text-sm font-medium text-clear-verified">NIH Evidence Result</p>
                    <h2 className="mt-2 text-2xl font-bold text-white">
                      {asked.slice(0, 72)}
                      {asked.length > 72 ? '...' : ''}
                    </h2>
                    {hasAnyContext(context) && (
                      <p className="mt-2 text-sm text-slate-400">Based on your profile: {summarize(context)}</p>
                    )}
                  </div>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                {a.forYou && (
                  <EvidenceCard title="Based on the information you provided" tone="profile">
                    <p>{withMarkers(a.forYou)}</p>
                  </EvidenceCard>
                )}
                {a.evidence && (
                  <EvidenceCard title="What NIH Says" tone="evidence">
                    <p>{withMarkers(a.evidence)}</p>
                  </EvidenceCard>
                )}
                {a.marketing && (
                  <EvidenceCard title="Product or Marketing Claims" tone="marketing">
                    <p>{withMarkers(a.marketing)}</p>
                  </EvidenceCard>
                )}
                {a.healthConsiderations && (
                  <EvidenceCard title="Relevant Health Considerations" tone="considerations">
                    <p>{withMarkers(a.healthConsiderations)}</p>
                  </EvidenceCard>
                )}
                {a.medicationInteractions && (
                  <EvidenceCard title="Medication Interactions" tone="interactions">
                    <p>{withMarkers(a.medicationInteractions)}</p>
                  </EvidenceCard>
                )}
                {a.uncertainty && (
                  <EvidenceCard title="What's Not Known" tone="uncertainty">
                    <p>{withMarkers(a.uncertainty)}</p>
                  </EvidenceCard>
                )}
              </div>

              {a.questionsForClinician && a.questionsForClinician.length > 0 && (
                <section className="rounded-lg border border-dashed border-violet-300/30 bg-violet-300/[0.07] p-5">
                  <h3 className="mb-3 text-sm font-bold text-white">Questions to ask a clinician</h3>
                  <ul className="space-y-2 text-[0.95rem] text-slate-200">
                    {a.questionsForClinician.map((q) => (
                      <li key={q} className="flex gap-2">
                        <span className="text-violet-200">-</span>
                        <span>{q}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-white/10 bg-white/[0.03] p-4">
                {signedIn ? (
                  <>
                    <button
                      type="button"
                      onClick={saveCard}
                      disabled={saveState === 'saving' || saveState === 'saved'}
                      className="rounded-md bg-white px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:bg-slate-600 disabled:text-slate-300"
                    >
                      {saveState === 'saving' ? 'Saving...' : saveState === 'saved' ? 'Saved' : 'Save Decision Card'}
                    </button>
                    {saveState === 'saved' && (
                      <Link href="/cards" className="text-sm font-medium text-teal-100 hover:text-white">
                        View saved cards
                      </Link>
                    )}
                    {saveState === 'error' && <span className="text-sm text-red-200">Could not save. Try again.</span>}
                  </>
                ) : (
                  <p className="text-sm text-slate-400">
                    <Link href="/login?next=/ask" className="font-semibold text-teal-100 hover:text-white">
                      Sign in
                    </Link>{' '}
                    to save this Decision Card. Your answer will still be here.
                  </p>
                )}

                <button
                  type="button"
                  onClick={reset}
                  className="ml-auto rounded-md px-3 py-2 text-sm font-semibold text-slate-400 transition hover:bg-white/5 hover:text-white"
                >
                  Clear answer
                </button>
              </div>

              {result.citations.length > 0 && (
                <section className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
                  <h3 className="mb-3 text-sm font-bold text-white">Sources - NIH</h3>
                  <ol className="space-y-2 text-sm">
                    {result.citations.map((c) => (
                      <li key={c.indices.join('-')} className="flex flex-wrap gap-2">
                        <span className="shrink-0 font-semibold text-violet-200">
                          {c.indices.map((i) => `[${i}]`).join('')}
                        </span>
                        <a
                          href={c.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-slate-200 hover:text-white hover:underline"
                        >
                          <span className="font-medium">{c.supplement}</span>
                          {c.section && <span className="text-slate-400"> - {c.section}</span>}
                        </a>
                        <span className="shrink-0 text-xs text-teal-200">{agencyShort(c.url)}</span>
                      </li>
                    ))}
                  </ol>
                </section>
              )}
            </div>
          )}
        </section>
      </div>

      <footer className="mt-12 border-t border-white/10 pt-5 text-xs leading-relaxed text-slate-500">
        ClearLabel summarizes public information from NIH&apos;s Office of Dietary Supplements and
        National Center for Complementary and Integrative Health. It is not medical advice and does
        not diagnose or treat. Talk to a clinician before changing what you take.
      </footer>
    </main>
  );
}
