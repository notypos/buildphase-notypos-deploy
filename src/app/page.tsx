'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import HealthContextPanel from '@/components/HealthContextPanel';
import { createClient } from '@/lib/supabase/client';
import { storeAnswer, loadAnswer, markSaved, clearAnswer } from '@/lib/last-answer';
import {
  EMPTY_CONTEXT,
  loadContext,
  saveContext,
  clearContext,
  defaultReadingLevel,
  hasAnyContext,
  type HealthContext,
} from '@/lib/health-context';

const READING_LEVELS = [
  { id: 'simple', label: 'Simple', hint: 'Shorter sentences, everyday words' },
  { id: 'standard', label: 'Standard', hint: 'Normal adult reading level' },
] as const;

const EXAMPLES = [
  'How much vitamin D do I need?',
  'Can too much iron be harmful?',
  'Does zinc help with colds?',
  'Is ashwagandha safe?',
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

function withMarkers(text: string) {
  return text.split(/(\[\d+\])/g).map((part, i) => {
    const m = part.match(/^\[(\d+)\]$/);
    if (!m) return <span key={i}>{part}</span>;
    return (
      <sup key={i} className="ml-0.5 rounded bg-teal-100 px-1 text-[0.65rem] font-semibold text-teal-800">
        {m[1]}
      </sup>
    );
  });
}

function Card({
  title,
  tone,
  children,
}: {
  title: string;
  tone: 'you' | 'evidence' | 'uncertain' | 'marketing' | 'considerations' | 'interactions';
  children: React.ReactNode;
}) {
  const tones = {
    you: 'bg-slate-900 text-white',
    evidence: 'bg-teal-50 text-teal-900',
    uncertain: 'bg-sky-50 text-sky-900',
    marketing: 'bg-amber-50 text-amber-900',
    considerations: 'bg-violet-50 text-violet-900',
    interactions: 'bg-rose-50 text-rose-900',
  };
  const labels = {
    you: 'text-slate-300',
    evidence: 'text-teal-700',
    uncertain: 'text-sky-700',
    marketing: 'text-amber-700',
    considerations: 'text-violet-700',
    interactions: 'text-rose-700',
  };
  return (
    <section className={`rounded-xl p-5 ${tones[tone]}`}>
      <h3 className={`mb-2 text-xs font-bold tracking-wide uppercase ${labels[tone]}`}>{title}</h3>
      <div className="space-y-2 text-[0.95rem] leading-relaxed">{children}</div>
    </section>
  );
}

export default function Home() {
  const [question, setQuestion] = useState('');
  const [context, setContext] = useState<HealthContext>(EMPTY_CONTEXT);
  const [levelOverride, setLevelOverride] = useState<string | null>(null);
  // Spanish toggle removed from the UI until scripts/ingest.ts --lang es has
  // actually landed the Spanish corpus — see design.md. Locked to 'en' for now.
  const language: 'en' | 'es' = 'en';
  const [result, setResult] = useState<AskResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [asked, setAsked] = useState('');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // sessionStorage is unavailable during SSR, so hydrate after mount.
  useEffect(() => {
    setContext(loadContext());

    // Restore the last answer so navigating away — including the round trip
    // through sign-in — doesn't discard what the reader was looking at.
    const stored = loadAnswer();
    if (stored) {
      setResult(stored.result as AskResult);
      setQuestion(stored.question);
      setAsked(stored.question);
      if (stored.savedCardId) setSaveState('saved');
    }
  }, []);

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
          // Session-only. The server uses it for this request and never stores it.
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
    <main className="mx-auto min-h-screen max-w-3xl px-5 py-10">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">
          Plain-language answers about dietary supplements
        </h1>
        <p className="mt-1 text-slate-600">
          Grounded in NIH Office of Dietary Supplements fact sheets, with citations. No account
          needed.
        </p>
      </header>

      <HealthContextPanel
        value={context}
        onChange={updateContext}
        onClear={() => {
          clearContext();
          setContext(EMPTY_CONTEXT);
        }}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium tracking-wide text-slate-500 uppercase">
          Reading level
        </span>
        {READING_LEVELS.map((opt) => (
          <button
            key={opt.id}
            onClick={() => setLevelOverride(opt.id)}
            title={opt.hint}
            className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
              readingLevel === opt.id
                ? 'bg-teal-700 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            {opt.label}
          </button>
        ))}
        {levelOverride === null && context.ageYears !== null && (
          <span className="text-xs text-slate-400">set from your age</span>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(question);
        }}
        className="mb-3"
      >
        <div className="flex gap-2">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask about a supplement…"
            className="flex-1 rounded-lg border border-slate-300 px-4 py-3 text-slate-900 outline-none focus:border-teal-600 focus:ring-1 focus:ring-teal-600"
          />
          <button
            type="submit"
            disabled={loading || !question.trim()}
            className="rounded-lg bg-teal-700 px-5 py-3 font-medium text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {loading ? 'Thinking…' : 'Ask'}
          </button>
        </div>
      </form>

      <div className="mb-8 flex flex-wrap gap-2">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            onClick={() => {
              setQuestion(ex);
              submit(ex);
            }}
            className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:border-teal-600 hover:text-teal-700"
          >
            {ex}
          </button>
        ))}
      </div>

      {loading && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
      )}

      {error && (
        <div className="rounded-xl bg-red-50 p-5 text-red-800">
          <h3 className="mb-1 text-xs font-bold tracking-wide uppercase">Something went wrong</h3>
          <p className="text-[0.95rem]">{error}</p>
        </div>
      )}

      {result?.refused && (
        <div className="rounded-xl bg-slate-100 p-5">
          <h3 className="mb-2 text-xs font-bold tracking-wide text-slate-500 uppercase">
            Outside the NIH fact sheets
          </h3>
          <p className="text-[0.95rem] leading-relaxed text-slate-700">{result.refusalReason}</p>
          <button
            onClick={reset}
            className="mt-3 text-sm font-medium text-slate-500 hover:text-slate-900"
          >
            Clear answer
          </button>
        </div>
      )}

      {a && (
        <div className="space-y-3">
          {a.forYou && (
            <Card title="Based on the information you provided" tone="you">
              <p>{withMarkers(a.forYou)}</p>
            </Card>
          )}
          {a.evidence && (
            <Card title="What the evidence shows" tone="evidence">
              <p>{withMarkers(a.evidence)}</p>
            </Card>
          )}
          {a.uncertainty && (
            <Card title="What's still uncertain" tone="uncertain">
              <p>{withMarkers(a.uncertainty)}</p>
            </Card>
          )}
          {a.marketing && (
            <Card title="What the marketing claims" tone="marketing">
              <p>{withMarkers(a.marketing)}</p>
            </Card>
          )}
          {a.healthConsiderations && (
            <Card title="Relevant health considerations" tone="considerations">
              <p>{withMarkers(a.healthConsiderations)}</p>
            </Card>
          )}
          {a.medicationInteractions && (
            <Card title="Medication interactions" tone="interactions">
              <p>{withMarkers(a.medicationInteractions)}</p>
            </Card>
          )}

          {a.questionsForClinician && a.questionsForClinician.length > 0 && (
            <section className="rounded-xl border border-slate-300 border-dashed p-5">
              <h3 className="mb-3 text-xs font-bold tracking-wide text-slate-500 uppercase">
                Worth asking a clinician
              </h3>
              <ul className="space-y-1.5 text-[0.95rem] text-slate-700">
                {a.questionsForClinician.map((q) => (
                  <li key={q} className="flex gap-2">
                    <span className="text-slate-400">—</span>
                    {q}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="flex items-center gap-3 py-1">
            {signedIn ? (
              <>
                <button
                  onClick={saveCard}
                  disabled={saveState === 'saving' || saveState === 'saved'}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:bg-slate-300"
                >
                  {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : 'Save this'}
                </button>
                {saveState === 'saved' && (
                  <Link href="/cards" className="text-sm font-medium text-teal-700 hover:underline">
                    View saved cards →
                  </Link>
                )}
                {saveState === 'error' && (
                  <span className="text-sm text-red-700">Could not save. Try again.</span>
                )}
              </>
            ) : (
              <p className="text-sm text-slate-500">
                <Link href="/login?next=/" className="font-medium text-teal-700 hover:underline">
                  Sign in
                </Link>{' '}
                to save this — your answer will still be here.
              </p>
            )}

            <button
              onClick={reset}
              className="ml-auto text-sm font-medium text-slate-500 hover:text-slate-900"
            >
              Clear answer
            </button>
          </div>

          {result!.citations.length > 0 && (
            <section className="rounded-xl border border-slate-200 p-5">
              <h3 className="mb-3 text-xs font-bold tracking-wide text-slate-500 uppercase">
                Sources — NIH Office of Dietary Supplements
              </h3>
              <ol className="space-y-1.5 text-sm">
                {result!.citations.map((c) => (
                  <li key={c.indices.join('-')} className="flex gap-2">
                    <span className="shrink-0 font-semibold text-teal-700">
                      {c.indices.map((i) => `[${i}]`).join('')}
                    </span>
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-slate-700 hover:text-teal-700 hover:underline"
                    >
                      <span className="font-medium">{c.supplement}</span>
                      {c.section && <span className="text-slate-500"> — {c.section}</span>}
                    </a>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>
      )}

      <footer className="mt-12 border-t border-slate-200 pt-5 text-xs leading-relaxed text-slate-500">
        ClearLabel summarizes public information from the NIH Office of Dietary Supplements. It is
        not medical advice and does not diagnose or treat. Talk to a clinician before changing what
        you take.
      </footer>
    </main>
  );
}
