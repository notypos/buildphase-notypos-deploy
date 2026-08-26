'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

/**
 * Adds a row directly to medications via the browser Supabase client, same
 * pattern as AddStackItemForm — RLS ("own meds") enforces ownership.
 */
export default function AddMedicationForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || saving) return;
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

    const { error: insertError } = await supabase.from('medications').insert({
      user_id: user.id,
      name: name.trim(),
    });

    setSaving(false);
    if (insertError) {
      setError('Could not save that — try again.');
      return;
    }

    setName('');
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
        + Add a medication
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-lg border border-white/10 bg-[#07111f]/70 p-4">
      <div>
        <label htmlFor="med_name" className="mb-1 block text-sm font-medium text-slate-200">
          Medication name
        </label>
        <input
          id="med_name"
          type="text"
          required
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Warfarin"
          className="w-full rounded-md border border-white/10 bg-[#081221] px-3 py-2 text-white outline-none transition placeholder:text-slate-600 focus:border-violet-300/55 focus:ring-2 focus:ring-violet-400/20"
        />
      </div>

      {error && <p className="text-sm text-red-200">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving || !name.trim()}
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
