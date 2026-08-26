'use client';

import { useState } from 'react';
import {
  showsPregnancyOptions,
  summarize,
  hasAnyContext,
  normalizeContext,
  type HealthContext,
  type Sex,
} from '@/lib/health-context';

/**
 * Minimum-necessary personalization: only the fields NIH reference tables are
 * keyed to. No conditions, no medications, no medical history — condition and
 * interaction information comes out of the retrieved fact sheet instead.
 */
export default function HealthContextPanel({
  value,
  onChange,
  onClear,
  title = 'Personalize this answer',
}: {
  value: HealthContext;
  onChange: (next: HealthContext) => void;
  onClear: () => void;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  // Normalized on write: changing sex to male or clearing it must also clear
  // pregnancy and breastfeeding, not merely hide the checkboxes.
  const set = (patch: Partial<HealthContext>) => onChange(normalizeContext({ ...value, ...patch }));

  return (
    <div className="mb-4 rounded-lg border border-white/10 bg-white/[0.03]">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="min-w-0">
          <span className="text-sm font-semibold text-slate-100">{title}</span>
          <span className="ml-2 text-sm text-slate-500">{summarize(value)}</span>
        </span>
        <span className="text-slate-400">{open ? '-' : '+'}</span>
      </button>

      {open && (
        <div className="space-y-5 border-t border-white/10 px-4 py-4">
          <p className="rounded-lg border border-teal-300/20 bg-teal-300/[0.08] px-3 py-2 text-xs leading-relaxed text-teal-50">
            <span className="font-semibold">Used only when NIH recommendations differ by age, sex, or life stage.</span>{' '}
            This stays in your browser tab and is sent only with the answer you request.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="age" className="mb-1 block text-sm font-medium text-slate-200">
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
                className="w-full rounded-md border border-white/10 bg-[#081221] px-3 py-2 text-white outline-none transition placeholder:text-slate-600 focus:border-violet-300/55 focus:ring-2 focus:ring-violet-400/20"
              />
              <p className="mt-1 text-xs text-slate-500">
                NIH limits change at 18, 50 and 70 — exact age matters.
              </p>
            </div>

            <div>
              <span className="mb-1 block text-sm font-medium text-slate-200">Sex for NIH values</span>
              <div className="flex gap-2">
                {(['female', 'male'] as Sex[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => set({ sex: value.sex === s ? null : s })}
                    className={`flex-1 rounded-lg px-3 py-2 text-sm capitalize transition ${
                      value.sex === s
                        ? 'bg-violet-300/[0.18] text-white ring-1 ring-violet-300/[0.35]'
                        : 'bg-white/5 text-slate-400 hover:bg-white/10 hover:text-slate-100'
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
              <legend className="mb-1 text-sm font-medium text-slate-200">
                Life stage
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
                      value[key]
                        ? 'bg-teal-300/[0.18] text-teal-50 ring-1 ring-teal-300/[0.35]'
                        : 'bg-white/5 text-slate-400 hover:bg-white/10 hover:text-slate-100'
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
              className="rounded-md px-3 py-1.5 text-sm font-medium text-slate-400 transition hover:bg-red-300/10 hover:text-red-100"
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}
