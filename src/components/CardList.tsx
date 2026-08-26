'use client';

import { useState } from 'react';
import { agencyShort } from '@/lib/rag/sources';

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
  { key: 'forYou', label: 'Your Intake Context', className: 'border-slate-500/20 bg-slate-200/[0.08] text-slate-100' },
  { key: 'evidence', label: 'What NIH Says', className: 'border-teal-300/20 bg-teal-300/[0.08] text-teal-50' },
  { key: 'uncertainty', label: "What's Uncertain", className: 'border-sky-300/20 bg-sky-300/[0.08] text-sky-50' },
  { key: 'marketing', label: 'Evidence Status', className: 'border-amber-300/25 bg-amber-300/[0.08] text-amber-50' },
  { key: 'healthConsiderations', label: 'Relevant Health Considerations', className: 'border-violet-300/20 bg-violet-300/[0.08] text-violet-50' },
  { key: 'medicationInteractions', label: 'Medication Interactions', className: 'border-rose-300/20 bg-rose-300/[0.08] text-rose-50' },
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
          <li key={card.id} className="rounded-lg border border-white/10 bg-white/[0.04] print:break-inside-avoid">
            <div className="flex items-start justify-between gap-3 px-5 py-4">
              <button
                onClick={() => setOpenId(open ? null : card.id)}
                aria-expanded={open}
                className="flex-1 text-left"
              >
                <span className="font-semibold text-white">{card.title}</span>
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
                  className="rounded-md px-2 py-1 text-sm font-semibold text-slate-400 transition hover:bg-white/5 hover:text-white"
                >
                  Print
                </button>
                <button
                  onClick={() => remove(card.id)}
                  disabled={busy === card.id}
                  className="rounded-md px-2 py-1 text-sm font-semibold text-slate-500 transition hover:bg-red-300/10 hover:text-red-100 disabled:opacity-50"
                >
                  {busy === card.id ? '...' : 'Delete'}
                </button>
              </div>
            </div>

            {open && (
              <div className="space-y-3 border-t border-white/10 px-5 py-4">
                {SECTIONS.map(({ key, label, className }) => {
                  const text = card.guidance?.[key];
                  if (!text) return null;
                  return (
                    <section key={key} className={`rounded-lg border p-4 ${className}`}>
                      <h3 className="mb-1.5 text-sm font-bold text-white">
                        {label}
                      </h3>
                      <p className="text-[0.95rem] leading-relaxed text-slate-200">{text}</p>
                    </section>
                  );
                })}

                {card.questions_for_clinician && card.questions_for_clinician.length > 0 && (
                  <section className="rounded-lg border border-dashed border-violet-300/30 bg-violet-300/[0.07] p-4">
                    <h3 className="mb-2 text-sm font-bold text-white">
                      Questions to ask a clinician
                    </h3>
                    <ul className="space-y-1.5 text-[0.95rem] text-slate-200">
                      {card.questions_for_clinician.map((q) => (
                        <li key={q} className="flex gap-2">
                          <span className="text-violet-200">-</span>
                          {q}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {card.citations?.length > 0 && (
                  <section className="rounded-lg border border-white/10 bg-[#07111f]/70 p-4">
                    <h3 className="mb-2 text-sm font-bold text-white">
                      Sources - NIH
                    </h3>
                    <ol className="space-y-1 text-sm">
                      {card.citations.map((c) => (
                        <li key={c.indices.join('-')} className="flex gap-2">
                          <span className="shrink-0 font-semibold text-violet-200">
                            {c.indices.map((i) => `[${i}]`).join('')}
                          </span>
                          <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-slate-200 hover:text-white hover:underline">
                            <span className="font-medium">{c.supplement}</span>
                            {c.section && <span className="text-slate-500"> - {c.section}</span>}
                          </a>
                          <span className="shrink-0 text-xs text-teal-200">{agencyShort(c.url)}</span>
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
