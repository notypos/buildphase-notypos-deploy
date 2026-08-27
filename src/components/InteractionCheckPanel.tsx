'use client';

import { useMemo, useState } from 'react';

interface Medication {
  id: string;
  name: string;
}

interface StackItem {
  id: string;
  label_name: string;
  supplement?: string | null;
  ingredients?: { nutrient: string; amount: number; unit: string }[] | null;
}

interface Finding {
  supplement: string;
  medication: string;
  flagged: boolean;
  detail: string;
}

interface InteractionResult {
  findings: Finding[];
  summary: string;
  uncovered: string[];
  failed: string[];
}

/**
 * Which name to check each stack item under. Ingredient-level nutrient names
 * (e.g. "Vitamin K") match NIH's single-nutrient fact sheets far better than
 * a branded product name, so those are preferred when the item has them.
 */
function deriveCheckNames(items: StackItem[]): string[] {
  const names = new Set<string>();
  for (const item of items) {
    if (item.ingredients?.length) {
      for (const ing of item.ingredients) {
        const n = ing.nutrient?.trim();
        if (n) names.add(n);
      }
    } else {
      const n = (item.supplement || item.label_name)?.trim();
      if (n) names.add(n);
    }
  }
  return [...names];
}

/**
 * Checks the supplements already in your stack against selected saved
 * medications, grounded in retrieved NIH fact sheet text — see
 * src/lib/rag/interactions.ts. Separate from the dose-safety check above:
 * this is about interaction claims in free text, not a dose-vs-limit sum.
 *
 * No free-typed supplement box: the point of the check is "does anything
 * I've already added interact with what I'm on," so it runs against your
 * saved stack automatically rather than asking you to retype names.
 */
export default function InteractionCheckPanel({
  medications,
  items,
}: {
  medications: Medication[];
  items: StackItem[];
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InteractionResult | null>(null);

  const supplementNames = useMemo(() => deriveCheckNames(items), [items]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function runCheck() {
    if (supplementNames.length === 0 || selected.size === 0 || checking) return;
    setChecking(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch('/api/interactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ supplementNames, medicationIds: [...selected] }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? 'Could not run the check.');
        return;
      }
      setResult(data as InteractionResult);
    } catch {
      setError('Could not run the check. Check your connection and try again.');
    } finally {
      setChecking(false);
    }
  }

  const canRun = supplementNames.length > 0 && selected.size > 0;
  const flaggedFindings = result?.findings.filter((f) => f.flagged) ?? [];

  return (
    <div className="mt-6 space-y-5 rounded-lg border border-white/10 bg-[#07111f]/70 p-5">
      <div>
        <h3 className="text-lg font-bold text-white">Check your supplements against your medications</h3>
        <p className="mt-1 text-sm leading-relaxed text-slate-400">
          Pick which medications to check, then press the button — every supplement already in
          your stack is checked automatically.
        </p>
      </div>

      <div>
        <p className="mb-2 text-sm font-medium text-slate-200">1. Medications to check</p>
        {medications.length === 0 ? (
          <p className="rounded-lg border border-dashed border-white/[0.15] px-4 py-3 text-sm text-slate-500">
            Add a medication above first.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {medications.map((m) => {
              const active = selected.has(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => toggle(m.id)}
                  aria-pressed={active}
                  className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
                    active
                      ? 'bg-violet-300/[0.18] text-white ring-1 ring-violet-300/[0.35]'
                      : 'bg-white/5 text-slate-400 hover:bg-white/10 hover:text-slate-100'
                  }`}
                >
                  {m.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <p className="mb-2 text-sm font-medium text-slate-200">2. Supplements checked (from your stack)</p>
        {supplementNames.length === 0 ? (
          <p className="rounded-lg border border-dashed border-white/[0.15] px-4 py-3 text-sm text-slate-500">
            Add a supplement in the Supplements tab first.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {supplementNames.map((name) => (
              <span
                key={name}
                className="rounded-full border border-white/10 bg-white/5 px-3.5 py-1.5 text-sm text-slate-300"
              >
                {name}
              </span>
            ))}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={runCheck}
        disabled={checking || !canRun}
        className="rounded-md bg-gradient-to-r from-[#7557f8] to-[#32d1b0] px-3.5 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45"
      >
        {checking ? 'Checking...' : 'Check for interactions'}
      </button>

      {error && <p className="text-sm text-red-200">{error}</p>}

      {result && (
        <div className="space-y-3 border-t border-white/10 pt-4">
          <p className="text-sm leading-relaxed text-slate-200">{result.summary}</p>
          {result.uncovered.length > 0 && (
            <p className="text-xs text-slate-500">
              Not covered by an NIH fact sheet: {result.uncovered.join(', ')}
            </p>
          )}
          {result.failed.length > 0 && (
            <p className="text-xs text-amber-200">
              Couldn&apos;t complete the check for: {result.failed.join(', ')} — try again in a moment.
            </p>
          )}

          {flaggedFindings.length === 0 ? (
            <p className="rounded-lg border border-white/10 bg-white/[0.04] p-3 text-sm text-slate-300">
              No interactions mentioned in NIH&apos;s fact sheets for the supplements and medications
              checked.
            </p>
          ) : (
            <div className="space-y-2">
              {flaggedFindings.map((f, i) => (
                <div key={i} className="rounded-lg border border-red-300/30 bg-red-300/10 p-3 text-sm text-red-50">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-red-300/40 bg-red-300/15 px-2 py-0.5 text-[0.7rem] font-semibold whitespace-nowrap text-red-100">
                      Mentioned
                    </span>
                    <span className="font-semibold">
                      {f.supplement} + {f.medication}
                    </span>
                  </div>
                  <p className="mt-1.5 leading-relaxed">{f.detail}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
