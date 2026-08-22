'use client';

import { useState } from 'react';
import { showsPregnancyOptions, summarize, hasAnyContext, type HealthContext, type Sex } from '@/lib/health-context';

/**
 * Minimum-necessary personalization: only the fields NIH reference tables are
 * keyed to. No conditions, no medications, no medical history — condition and
 * interaction information comes out of the retrieved fact sheet instead.
 */
export default function HealthContextPanel({
  value,
  onChange,
  onClear,
}: {
  value: HealthContext;
  onChange: (next: HealthContext) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const set = (patch: Partial<HealthContext>) => onChange({ ...value, ...patch });

  return (
    <div className="mb-4 rounded-xl border border-slate-200">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span>
          <span className="text-sm font-semibold text-slate-800">About you</span>
          <span className="ml-2 text-sm text-slate-500">{summarize(value)}</span>
        </span>
        <span className="text-slate-400">{open ? '−' : '+'}</span>
      </button>

      {open && (
        <div className="space-y-5 border-t border-slate-200 px-4 py-4">
          <p className="rounded-lg bg-teal-50 px-3 py-2 text-xs leading-relaxed text-teal-900">
            <span className="font-semibold">None of this is saved.</span> It stays in this
            browser tab, is used only for the answers you request, and disappears when you close
            the tab. NIH publishes different intake amounts by age, sex, and life stage — these
            three fields are what those tables are keyed to.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="age" className="mb-1 block text-sm font-medium text-slate-700">
                Age
              </label>
              <input
                id="age"
                type="number"
                min={0}
                max={120}
                value={value.ageYears ?? ''}
                onChange={(e) => set({ ageYears: e.target.value === '' ? null : Number(e.target.value) })}
                placeholder="e.g. 34"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-teal-600 focus:ring-1 focus:ring-teal-600"
              />
              <p className="mt-1 text-xs text-slate-500">
                NIH limits change at 18, 50 and 70 — exact age matters.
              </p>
            </div>

            <div>
              <span className="mb-1 block text-sm font-medium text-slate-700">Sex</span>
              <div className="flex gap-2">
                {(['female', 'male'] as Sex[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => set({ sex: value.sex === s ? null : s })}
                    className={`flex-1 rounded-lg px-3 py-2 text-sm capitalize transition ${
                      value.sex === s ? 'bg-teal-700 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-xs text-slate-500">As used by NIH intake tables.</p>
            </div>
          </div>

          {showsPregnancyOptions(value) && (
            <fieldset>
              <legend className="mb-1 text-sm font-medium text-slate-700">
                Pregnancy or breastfeeding
              </legend>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ['pregnant', 'Pregnant'],
                    ['breastfeeding', 'Breastfeeding'],
                  ] as const
                ).map(([key, label]) => (
                  <label
                    key={key}
                    className={`cursor-pointer rounded-full px-3.5 py-1.5 text-sm transition ${
                      value[key] ? 'bg-teal-700 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={value[key]}
                      onChange={(e) => set({ [key]: e.target.checked } as Partial<HealthContext>)}
                    />
                    {label}
                  </label>
                ))}
              </div>
              <p className="mt-1 text-xs text-slate-500">
                NIH publishes distinct amounts for pregnancy and lactation.
              </p>
            </fieldset>
          )}

          <p className="text-xs leading-relaxed text-slate-500">
            We don&apos;t ask about health conditions or medications. When the NIH fact sheet
            behind an answer discusses a condition or a drug interaction, that appears in the
            answer itself.
          </p>

          {hasAnyContext(value) && (
            <button
              type="button"
              onClick={onClear}
              className="text-sm font-medium text-slate-500 hover:text-red-700"
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}
