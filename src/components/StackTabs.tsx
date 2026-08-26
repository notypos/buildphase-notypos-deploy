'use client';

import { useState } from 'react';
import AddStackItemForm from '@/components/AddStackItemForm';
import DeleteStackItemButton from '@/components/DeleteStackItemButton';
import StackCheckPanel from '@/components/StackCheckPanel';
import AddMedicationForm from '@/components/AddMedicationForm';
import DeleteMedicationButton from '@/components/DeleteMedicationButton';
import InteractionCheckPanel from '@/components/InteractionCheckPanel';

interface StackItem {
  id: string;
  label_name: string;
  dose_amount: number | null;
  dose_unit: string | null;
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
    `rounded-lg px-3.5 py-2 text-sm font-medium transition ${
      tab === t ? 'bg-teal-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
    }`;

  return (
    <section className="mb-6">
      <div className="mb-3 flex gap-2">
        <button type="button" onClick={() => setTab('supplements')} className={tabClass('supplements')}>
          Supplements ({items.length})
        </button>
        <button type="button" onClick={() => setTab('medications')} className={tabClass('medications')}>
          Medications ({medications.length})
        </button>
      </div>

      {tab === 'supplements' ? (
        <div className="rounded-xl border border-slate-200 p-5">
          {items.length ? (
            <ul className="mb-4 space-y-1.5 text-sm text-slate-700">
              {items.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-2">
                  <span>
                    {i.label_name}
                    {i.dose_amount && ` — ${i.dose_amount} ${i.dose_unit ?? ''}`}
                  </span>
                  <DeleteStackItemButton id={i.id} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-4 text-sm text-slate-500">Nothing saved yet.</p>
          )}
          <AddStackItemForm />
          <StackCheckPanel itemCount={items.length} />
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 p-5">
          {medications.length ? (
            <ul className="mb-4 space-y-1.5 text-sm text-slate-700">
              {medications.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2">
                  <span>{m.name}</span>
                  <DeleteMedicationButton id={m.id} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-4 text-sm text-slate-500">Nothing saved yet.</p>
          )}
          <AddMedicationForm />
          <InteractionCheckPanel medications={medications} />
        </div>
      )}
    </section>
  );
}
