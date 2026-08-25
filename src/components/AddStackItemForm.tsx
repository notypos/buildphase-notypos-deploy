'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

const UNITS = ['mcg', 'mg', 'g', 'iu'] as const;

/**
 * Adds a row directly to stack_items via the browser Supabase client — there is
 * no /api/stack route. RLS (`auth.uid() = user_id`) is what actually enforces
 * ownership; user_id is set explicitly here because the table has no column
 * default for it.
 */
export default function AddStackItemForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [labelName, setLabelName] = useState('');
  const [doseAmount, setDoseAmount] = useState('');
  const [doseUnit, setDoseUnit] = useState<(typeof UNITS)[number]>('mg');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!labelName.trim() || saving) return;
    setSaving(true);
    setError(null);

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setError('Sign in again to save this.');
      setSaving(false);
      return;
    }

    const { error: insertError } = await supabase.from('stack_items').insert({
      user_id: user.id,
      label_name: labelName.trim(),
      dose_amount: doseAmount === '' ? null : Number(doseAmount),
      dose_unit: doseAmount === '' ? null : doseUnit,
    });

    setSaving(false);
    if (insertError) {
      setError('Could not save that — try again.');
      return;
    }

    setLabelName('');
    setDoseAmount('');
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg bg-teal-700 px-3.5 py-2 text-sm font-medium text-white hover:bg-teal-800"
      >
        + Add a supplement
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-lg border border-slate-200 p-4">
      <div>
        <label htmlFor="label_name" className="mb-1 block text-sm font-medium text-slate-700">
          Name, as printed on the bottle
        </label>
        <input
          id="label_name"
          type="text"
          required
          autoFocus
          value={labelName}
          onChange={(e) => setLabelName(e.target.value)}
          placeholder="e.g. Vitamin D3 2000 IU"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-teal-600 focus:ring-1 focus:ring-teal-600"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="dose_amount" className="mb-1 block text-sm font-medium text-slate-700">
            Dose (optional)
          </label>
          <input
            id="dose_amount"
            type="number"
            min={0}
            step="any"
            value={doseAmount}
            onChange={(e) => setDoseAmount(e.target.value)}
            placeholder="e.g. 50"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-teal-600 focus:ring-1 focus:ring-teal-600"
          />
          <p className="mt-1 text-xs text-slate-500">
            Needed for the upper-limit and cumulative-dose check.
          </p>
        </div>
        <div>
          <label htmlFor="dose_unit" className="mb-1 block text-sm font-medium text-slate-700">
            Unit
          </label>
          <select
            id="dose_unit"
            value={doseUnit}
            onChange={(e) => setDoseUnit(e.target.value as (typeof UNITS)[number])}
            disabled={doseAmount === ''}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-teal-600 focus:ring-1 focus:ring-teal-600 disabled:bg-slate-50 disabled:text-slate-400"
          >
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <p className="text-sm text-red-700">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving || !labelName.trim()}
          className="rounded-lg bg-teal-700 px-3.5 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="rounded-lg px-3.5 py-2 text-sm font-medium text-slate-500 hover:text-slate-700"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
