'use client';

import { useEffect, useState } from 'react';
import HealthContextPanel from '@/components/HealthContextPanel';
import {
  EMPTY_CONTEXT,
  loadContext,
  saveContext,
  clearContext,
  normalizeContext,
  type HealthContext,
} from '@/lib/health-context';

type Severity = 'high' | 'medium' | 'info';

interface Finding {
  kind: string;
  severity: Severity;
  nutrient: string;
  sources: string[];
  detail: string;
}

const SEVERITY_STYLE: Record<Severity, string> = {
  high: 'border-red-300 bg-red-50 text-red-900',
  medium: 'border-amber-300 bg-amber-50 text-amber-900',
  info: 'border-slate-200 bg-slate-50 text-slate-700',
};

const SEVERITY_LABEL: Record<Severity, string> = {
  high: '⚠️ Over the limit',
  medium: '🔶 Approaching the limit',
  info: 'ℹ️ For your information',
};

/**
 * Runs src/lib/nih/stack-check.ts across everything saved in My Stack.
 * Uses the same session-only age/sex/pregnancy context as the Ask page (same
 * sessionStorage key) — it never gets written to the database here either.
 */
export default function StackCheckPanel({ itemCount }: { itemCount: number }) {
  const [context, setContext] = useState<HealthContext>(EMPTY_CONTEXT);
  const [findings, setFindings] = useState<Finding[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setContext(loadContext());
  }, []);

  function updateContext(next: HealthContext) {
    setContext(next);
    saveContext(next);
    setFindings(null);
  }

  function handleClear() {
    setContext(EMPTY_CONTEXT);
    clearContext();
    setFindings(null);
  }

  async function runCheck() {
    if (context.ageYears === null || checking) return;
    setChecking(true);
    setError(null);
    setFindings(null);

    try {
      const normalized = normalizeContext(context);
      const res = await fetch('/api/stack-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ageYears: normalized.ageYears,
          sex: normalized.sex,
          pregnant: normalized.pregnant,
          breastfeeding: normalized.breastfeeding,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? 'Could not run the check.');
        return;
      }
      setFindings(data.findings as Finding[]);
    } catch {
      setError('Could not run the check. Check your connection and try again.');
    } finally {
      setChecking(false);
    }
  }

  return (
    <section className="mb-6 rounded-xl border border-slate-200 p-5">
      <h2 className="mb-1 text-xs font-bold tracking-wide text-slate-500 uppercase">
        Dose-safety check
      </h2>
      <p className="mb-3 text-sm text-slate-600">
        Adds up matching nutrients across everything in My Stack and compares the total to NIH
        upper limits for your age, sex, and life stage.
      </p>

      <HealthContextPanel value={context} onChange={updateContext} onClear={handleClear} />

      <button
        type="button"
        onClick={runCheck}
        disabled={context.ageYears === null || itemCount === 0 || checking}
        className="rounded-lg bg-teal-700 px-3.5 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        {checking ? 'Checking…' : 'Check my stack'}
      </button>
      {context.ageYears === null && (
        <p className="mt-1 text-xs text-slate-500">Enter your age above (under &quot;About you&quot;) to run this.</p>
      )}
      {itemCount === 0 && <p className="mt-1 text-xs text-slate-500">Add a supplement below first.</p>}

      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}

      {findings && (
        <div className="mt-4 space-y-2">
          {findings.length === 0 ? (
            <p className="rounded-lg border border-teal-200 bg-teal-50 p-3 text-sm text-teal-900">
              Nothing in your stack goes over an NIH upper limit for your age and sex.
            </p>
          ) : (
            findings.map((f, i) => (
              <div key={i} className={`rounded-lg border p-3 text-sm ${SEVERITY_STYLE[f.severity]}`}>
                <p className="font-semibold">
                  {SEVERITY_LABEL[f.severity]} · {f.nutrient}
                </p>
                <p className="mt-1">{f.detail}</p>
                {f.sources.length > 0 && (
                  <p className="mt-1 text-xs opacity-75">From: {f.sources.join(', ')}</p>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
}
