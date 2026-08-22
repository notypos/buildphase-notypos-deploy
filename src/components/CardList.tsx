'use client';

import { useState } from 'react';

interface Guidance {
  evidence: string;
  uncertainty: string;
  marketing: string;
  forYou?: string;
  healthConsiderations?: string;
  medicationInteractions?: string;
}

interface Citation {
  indices: number[];
  supplement: string;
  section: string | null;
  url: string;
}

export interface SavedCard {
  id: string;
  title: string;
  question: string | null;
  guidance: Guidance;
  citations: Citation[];
  questions_for_clinician: string[] | null;
  created_at: string;
}

const SECTIONS: { key: keyof Guidance; label: string; className: string }[] = [
  { key: 'forYou', label: 'Based on the information you provided', className: 'bg-slate-900 text-white' },
  { key: 'evidence', label: 'What the evidence shows', className: 'bg-teal-50 text-teal-900' },
  { key: 'uncertainty', label: "What's still uncertain", className: 'bg-sky-50 text-sky-900' },
  { key: 'marketing', label: 'What the marketing claims', className: 'bg-amber-50 text-amber-900' },
  { key: 'healthConsiderations', label: 'Relevant health considerations', className: 'bg-violet-50 text-violet-900' },
  { key: 'medicationInteractions', label: 'Medication interactions', className: 'bg-rose-50 text-rose-900' },
];

export default function CardList({ cards }: { cards: SavedCard[] }) {
  const [items, setItems] = useState(cards);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function remove(id: string) {
    setBusy(id);
    const res = await fetch(`/api/cards/${id}`, { method: 'DELETE' });
    if (res.ok) setItems((xs) => xs.filter((x) => x.id !== id));
    setBusy(null);
  }

  return (
    <ul className="space-y-3">
      {items.map((card) => {
        const open = openId === card.id;
        return (
          <li key={card.id} className="rounded-xl border border-slate-200 print:break-inside-avoid">
            <div className="flex items-start justify-between gap-3 px-5 py-4">
              <button
                onClick={() => setOpenId(open ? null : card.id)}
                aria-expanded={open}
                className="flex-1 text-left"
              >
                <span className="font-medium text-slate-900">{card.title}</span>
                <span className="mt-0.5 block text-xs text-slate-500">
                  {new Date(card.created_at).toLocaleDateString(undefined, {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>
              </button>
              <div className="flex shrink-0 items-center gap-3 print:hidden">
                <button
                  onClick={() => window.print()}
                  className="text-sm text-slate-500 hover:text-teal-700"
                >
                  Print
                </button>
                <button
                  onClick={() => remove(card.id)}
                  disabled={busy === card.id}
                  className="text-sm text-slate-400 hover:text-red-700 disabled:opacity-50"
                >
                  {busy === card.id ? '…' : 'Delete'}
                </button>
              </div>
            </div>

            {open && (
              <div className="space-y-3 border-t border-slate-200 px-5 py-4">
                {SECTIONS.map(({ key, label, className }) => {
                  const text = card.guidance?.[key];
                  if (!text) return null;
                  return (
                    <section key={key} className={`rounded-xl p-4 ${className}`}>
                      <h3 className="mb-1.5 text-xs font-bold tracking-wide uppercase opacity-70">
                        {label}
                      </h3>
                      <p className="text-[0.95rem] leading-relaxed">{text}</p>
                    </section>
                  );
                })}

                {card.questions_for_clinician && card.questions_for_clinician.length > 0 && (
                  <section className="rounded-xl border border-dashed border-slate-300 p-4">
                    <h3 className="mb-2 text-xs font-bold tracking-wide text-slate-500 uppercase">
                      Worth asking a clinician
                    </h3>
                    <ul className="space-y-1.5 text-[0.95rem] text-slate-700">
                      {card.questions_for_clinician.map((q) => (
                        <li key={q} className="flex gap-2">
                          <span className="text-slate-400">—</span>
                          {q}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {card.citations?.length > 0 && (
                  <section className="rounded-xl border border-slate-200 p-4">
                    <h3 className="mb-2 text-xs font-bold tracking-wide text-slate-500 uppercase">
                      Sources — NIH Office of Dietary Supplements
                    </h3>
                    <ol className="space-y-1 text-sm">
                      {card.citations.map((c) => (
                        <li key={c.indices.join('-')} className="flex gap-2">
                          <span className="shrink-0 font-semibold text-teal-700">
                            {c.indices.map((i) => `[${i}]`).join('')}
                          </span>
                          <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-slate-700 hover:underline">
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
          </li>
        );
      })}
    </ul>
  );
}
