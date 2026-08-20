'use client';

import { useState } from 'react';

const AUDIENCES = [
  { id: 'teen', label: 'Teen' },
  { id: 'adult', label: 'Adult' },
  { id: 'senior', label: 'Senior (65+)' },
  { id: 'caregiver', label: 'Caregiver' },
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
  subsection: string | null;
  url: string;
}

interface AskResult {
  answer: { evidence: string; uncertainty: string; marketing: string; citationsUsed: number[] } | null;
  citations: Citation[];
  refused: boolean;
  refusalReason?: string;
  topSimilarity: number;
}

/** Render [1][2] markers as small superscript chips. */
function withMarkers(text: string) {
  return text.split(/(\[\d+\])/g).map((part, i) => {
    const m = part.match(/^\[(\d+)\]$/);
    if (!m) return <span key={i}>{part}</span>;
    return (
      <sup
        key={i}
        className="ml-0.5 rounded bg-teal-100 px-1 text-[0.65rem] font-semibold text-teal-800"
      >
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
  tone: 'evidence' | 'uncertain' | 'marketing';
  children: React.ReactNode;
}) {
  const tones = {
    evidence: 'bg-teal-50 text-teal-900',
    uncertain: 'bg-sky-50 text-sky-900',
    marketing: 'bg-amber-50 text-amber-900',
  };
  const labels = {
    evidence: 'text-teal-700',
    uncertain: 'text-sky-700',
    marketing: 'text-amber-700',
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
  const [audience, setAudience] = useState<string>('adult');
  const [language, setLanguage] = useState<'en' | 'es'>('en');
  const [result, setResult] = useState<AskResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(q: string) {
    if (!q.trim() || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, audience, language }),
      });
      const json = await res.json();
      if (!res.ok) setError(json.error ?? 'Something went wrong.');
      else setResult(json);
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
        <h1 className="text-4xl font-bold tracking-tight text-slate-900">ClearLabel</h1>
        <p className="mt-1 text-slate-600">
          Plain-language answers about dietary supplements, grounded in NIH fact sheets.
        </p>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {AUDIENCES.map((opt) => (
          <button
            key={opt.id}
            onClick={() => setAudience(opt.id)}
            className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
              audience === opt.id
                ? 'bg-teal-700 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            {opt.label}
          </button>
        ))}
        <span className="mx-1 h-5 w-px bg-slate-200" />
        <button
          onClick={() => setLanguage(language === 'en' ? 'es' : 'en')}
          className="rounded-full bg-slate-100 px-3.5 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-200"
          title="Spanish answers come from NIH's own Spanish fact sheets"
        >
          {language === 'en' ? 'English' : 'Español'}
        </button>
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
        </div>
      )}

      {a && (
        <div className="space-y-3">
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
        ClearLabel summarizes public information from the NIH Office of Dietary Supplements. It is not
        medical advice and does not diagnose or treat. Talk to a clinician before changing what you take.
      </footer>
    </main>
  );
}
