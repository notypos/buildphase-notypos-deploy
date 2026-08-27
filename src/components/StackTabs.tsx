'use client';

import { useState } from 'react';
import Link from 'next/link';
import AddStackItemForm from '@/components/AddStackItemForm';
import DeleteStackItemButton from '@/components/DeleteStackItemButton';
import StackCheckPanel from '@/components/StackCheckPanel';
import AddMedicationForm from '@/components/AddMedicationForm';
import DeleteMedicationButton from '@/components/DeleteMedicationButton';
import InteractionCheckPanel from '@/components/InteractionCheckPanel';

interface StackItem {
  id: string;
  label_name: string;
  supplement?: string | null;
  dose_amount: number | null;
  dose_unit: string | null;
  frequency?: string | null;
  ingredients?: { nutrient: string; amount: number; unit: string }[] | null;
}

interface Medication {
  id: string;
  name: string;
}

export default function StackTabs({
  items,
  medications,
}: {
  items: StackItem[];
  medications: Medication[];
}) {
  const [tab, setTab] = useState<'supplements' | 'medications'>('supplements');

  const tabClass = (t: typeof tab) =>
    `rounded-md px-3.5 py-2 text-sm font-semibold transition ${
      tab === t
        ? 'bg-violet-300/[0.18] text-white ring-1 ring-violet-300/[0.35]'
        : 'text-slate-400 hover:bg-white/5 hover:text-slate-100'
    }`;

  const describeIngredients = (item: StackItem) => {
    if (item.ingredients?.length) {
      return item.ingredients.map((i) => i.nutrient).join(', ');
    }
    return item.supplement || item.label_name;
  };

  const amount = (item: StackItem) =>
    item.dose_amount != null ? `${item.dose_amount} ${item.dose_unit ?? ''}`.trim() : 'Not set';

  return (
    <section className="mb-6">
      <div className="mb-5 inline-flex rounded-lg border border-white/10 bg-[#07111f]/70 p-1">
        <button type="button" onClick={() => setTab('supplements')} className={tabClass('supplements')}>
          Supplements ({items.length})
        </button>
        <button type="button" onClick={() => setTab('medications')} className={tabClass('medications')}>
          Medications ({medications.length})
        </button>
      </div>

      {tab === 'supplements' ? (
        <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
          <div className="mb-5">
            <h2 className="text-lg font-bold text-white">Your Supplements</h2>
            <p className="mt-1 text-sm text-slate-500">Product label data and typed entries in one stack.</p>
          </div>

          {items.length ? (
            <>
              <div className="hidden overflow-hidden rounded-lg border border-white/10 md:block">
                <div className="grid grid-cols-[1.35fr_1.45fr_1fr_0.8fr_1fr_2.5rem] gap-4 border-b border-white/10 bg-[#07111f]/80 px-4 py-3 text-xs font-semibold text-slate-500">
                  <span>Supplement</span>
                  <span>Key Ingredients</span>
                  <span>Amount per Serving</span>
                  <span>Frequency</span>
                  <span>Daily Amount</span>
                  <span />
                </div>
                {items.map((i) => (
                  <div
                    key={i.id}
                    className="grid grid-cols-[1.35fr_1.45fr_1fr_0.8fr_1fr_2.5rem] gap-4 border-b border-white/[0.08] px-4 py-4 text-sm text-slate-200 last:border-b-0"
                  >
                    <span className="min-w-0 font-semibold text-white">{i.label_name}</span>
                    <span className="min-w-0 text-slate-400">{describeIngredients(i)}</span>
                    <span className="font-mono text-slate-300">{amount(i)}</span>
                    <span className="text-slate-400">{i.frequency ?? 'daily'}</span>
                    <span className="font-mono text-slate-300">{amount(i)} / day</span>
                    <span className="text-right">
                      <DeleteStackItemButton id={i.id} />
                    </span>
                  </div>
                ))}
              </div>

              <div className="space-y-3 md:hidden">
                {items.map((i) => (
                  <div key={i.id} className="rounded-lg border border-white/10 bg-[#07111f]/70 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="font-semibold text-white">{i.label_name}</h3>
                        <p className="mt-1 text-sm text-slate-400">{describeIngredients(i)}</p>
                      </div>
                      <DeleteStackItemButton id={i.id} />
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                      <div className="rounded-md bg-white/[0.04] p-3">
                        <p className="text-xs text-slate-500">Amount</p>
                        <p className="mt-1 font-mono text-slate-200">{amount(i)}</p>
                      </div>
                      <div className="rounded-md bg-white/[0.04] p-3">
                        <p className="text-xs text-slate-500">Frequency</p>
                        <p className="mt-1 text-slate-200">{i.frequency ?? 'daily'}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="mb-5 rounded-lg border border-dashed border-white/[0.15] bg-[#07111f]/70 p-8 text-center">
              <h3 className="text-lg font-bold text-white">Your stack is empty</h3>
              <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-400">
                Add supplements to see overlapping nutrients and total daily intake.
              </p>
              <div className="mt-5 flex flex-col justify-center gap-2 sm:flex-row">
                <Link
                  href="/scan"
                  className="rounded-md bg-gradient-to-r from-[#7557f8] to-[#32d1b0] px-4 py-2 text-sm font-semibold text-white"
                >
                  Scan Supplement
                </Link>
                <Link
                  href="/ask"
                  className="rounded-md border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-200"
                >
                  Ask about an ingredient
                </Link>
              </div>
            </div>
          )}
          <div className="mt-5">
            <AddStackItemForm />
          </div>
          <StackCheckPanel itemCount={items.length} />
        </div>
      ) : (
        <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
          <div className="mb-5">
            <h2 className="text-lg font-bold text-white">Your Medications</h2>
            <p className="mt-1 text-sm text-slate-500">
              Used only for the interaction check below — never shared elsewhere.
            </p>
          </div>

          {medications.length ? (
            <ul className="mb-6 grid gap-2 sm:grid-cols-2">
              {medications.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-[#07111f]/70 px-3.5 py-3"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-300/[0.14] text-xs font-semibold text-violet-100 ring-1 ring-violet-300/[0.25]">
                      {m.name.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="truncate text-sm font-medium text-white">{m.name}</span>
                  </span>
                  <DeleteMedicationButton id={m.id} />
                </li>
              ))}
            </ul>
          ) : (
            <div className="mb-6 rounded-lg border border-dashed border-white/[0.15] bg-[#07111f]/70 p-6 text-center">
              <p className="text-sm leading-relaxed text-slate-400">
                Add a medication to check your supplements against it for known interactions.
              </p>
            </div>
          )}
          <AddMedicationForm />
          <InteractionCheckPanel medications={medications} items={items} />
        </div>
      )}
    </section>
  );
}
