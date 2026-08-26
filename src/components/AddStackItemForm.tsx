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
        className="rounded-md bg-gradient-to-r from-[#7557f8] to-[#32d1b0] px-3.5 py-2 text-sm font-semibold text-white transition hover:brightness-110"
      >
        + Add a supplement
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-lg border border-white/10 bg-[#07111f]/70 p-4">
      <div>
        <label htmlFor="label_name" className="mb-1 block text-sm font-medium text-slate-200">
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
          className="w-full rounded-md border border-white/10 bg-[#081221] px-3 py-2 text-white outline-none transition placeholder:text-slate-600 focus:border-violet-300/55 focus:ring-2 focus:ring-violet-400/20"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="dose_amount" className="mb-1 block text-sm font-medium text-slate-200">
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
            className="w-full rounded-md border border-white/10 bg-[#081221] px-3 py-2 text-white outline-none transition placeholder:text-slate-600 focus:border-violet-300/55 focus:ring-2 focus:ring-violet-400/20"
          />
          <p className="mt-1 text-xs text-slate-500">
            Needed for the upper-limit and cumulative-dose check.
          </p>
        </div>
        <div>
          <label htmlFor="dose_unit" className="mb-1 block text-sm font-medium text-slate-200">
            Unit
          </label>
          <select
            id="dose_unit"
            value={doseUnit}
            onChange={(e) => setDoseUnit(e.target.value as (typeof UNITS)[number])}
            disabled={doseAmount === ''}
            className="w-full rounded-md border border-white/10 bg-[#081221] px-3 py-2 text-white outline-none transition focus:border-violet-300/55 focus:ring-2 focus:ring-violet-400/20 disabled:bg-white/5 disabled:text-slate-500"
          >
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <p className="text-sm text-red-200">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving || !labelName.trim()}
          className="rounded-md bg-white px-3.5 py-2 text-sm font-semibold text-slate-950 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:bg-slate-600 disabled:text-slate-300"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="rounded-md px-3.5 py-2 text-sm font-semibold text-slate-400 transition hover:bg-white/5 hover:text-white"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
