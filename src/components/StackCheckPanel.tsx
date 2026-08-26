'use client';

import { useEffect, useState } from 'react';
import HealthContextPanel from '@/components/HealthContextPanel';
import { formatFromMicrograms } from '@/lib/nih/units';
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
  totalMcg?: number;
  limitMcg?: number;
  limitLabel?: string;
  lifeStageRow?: string;
  detail: string;
}

type QuantifiedFinding = Finding & { severity: 'high' | 'medium'; totalMcg: number; limitMcg: number };

function isQuantified(f: Finding): f is QuantifiedFinding {
  return (f.severity === 'high' || f.severity === 'medium') && f.totalMcg != null && f.limitMcg != null;
}

const SEVERITY_META: Record<'high' | 'medium', { label: string; badge: string; bar: string; card: string }> = {
  high: {
    label: 'Above upper limit',
    badge: 'border-red-300/40 bg-red-300/15 text-red-100',
    bar: 'bg-red-400',
    card: 'border-red-300/25 bg-red-300/[0.06]',
  },
  medium: {
    label: 'Approaching upper limit',
    badge: 'border-amber-300/40 bg-amber-300/15 text-amber-100',
    bar: 'bg-amber-400',
    card: 'border-amber-300/25 bg-amber-300/[0.06]',
  },
};

/**
 * Runs src/lib/nih/stack-check.ts across everything saved in My Stack.
 * Uses the same session-only age/sex/pregnancy context as the Ask page (same
 * sessionStorage key) — it never gets written to the database here either.
 *
 * Findings that carry an actual total-vs-limit comparison (high/medium
 * severity) get a scannable stat card; everything else (no NIH limit
 * published, unit not comparable) is informational-only and is grouped
 * separately below so it doesn't compete for the same visual weight as a
 * real overage warning.
 */
export default function StackCheckPanel({ itemCount }: { itemCount: number }) {
  const [context, setContext] = useState<HealthContext>(EMPTY_CONTEXT);
  const [findings, setFindings] = useState<Finding[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setContext(loadContext());
    });
    return () => {
      cancelled = true;
    };
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

  const canRun = context.ageYears !== null && itemCount > 0;
  const quantified = (findings ?? []).filter(isQuantified);
  const informational = (findings ?? []).filter((f) => !isQuantified(f));

  return (
    <section className="mt-6 rounded-lg border border-white/10 bg-[#07111f]/70 p-5">
      <h2 className="text-lg font-bold text-white">Nutrient total check</h2>
      <p className="mt-2 mb-4 max-w-3xl text-sm leading-relaxed text-slate-400">
        Adds up matching nutrients across everything in My Stack and compares the total to NIH
        upper limits for your age, sex, and life stage.
      </p>

      <HealthContextPanel
        value={context}
        onChange={updateContext}
        onClear={handleClear}
        title="Personalize this check"
      />

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={runCheck}
          disabled={!canRun || checking}
          className="rounded-md bg-gradient-to-r from-[#7557f8] to-[#32d1b0] px-3.5 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45"
        >
          {checking ? 'Checking...' : 'Check my stack'}
        </button>
        {!canRun && (
          <p className="text-xs text-slate-500">
            {context.ageYears === null
              ? 'Enter your age above (under "About you") to run this.'
              : 'Add a supplement below first.'}
          </p>
        )}
      </div>

      {error && <p className="mt-3 text-sm text-red-200">{error}</p>}

      {findings && (
        <div className="mt-5 space-y-5">
          {findings.length === 0 ? (
            <p className="rounded-lg border border-teal-300/25 bg-teal-300/[0.08] p-4 text-sm text-teal-50">
              Nothing in your stack goes over an NIH upper limit for your age and sex.
            </p>
          ) : (
            <>
              {quantified.length > 0 && (
                <div className="grid gap-3 lg:grid-cols-2">
                  {quantified.map((f, i) => {
                    const meta = SEVERITY_META[f.severity];
                    const pct = Math.round((f.totalMcg / f.limitMcg) * 100);
                    return (
                      <div key={i} className={`rounded-lg border p-4 ${meta.card}`}>
                        <div className="flex items-start justify-between gap-3">
                          <h3 className="font-semibold text-white">{f.nutrient}</h3>
                          <span
                            className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold whitespace-nowrap ${meta.badge}`}
                          >
                            {meta.label}
                          </span>
                        </div>

                        <div className="mt-3 flex items-end justify-between gap-4">
                          <div>
                            <p className="text-xs text-slate-400">Your total</p>
                            <p className="font-mono text-2xl font-semibold text-white">
                              {formatFromMicrograms(f.totalMcg)}
                              <span className="ml-1 text-sm font-normal text-slate-400">/ day</span>
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs text-slate-400">NIH upper limit</p>
                            <p className="font-mono text-lg text-slate-200">
                              {f.limitLabel ?? formatFromMicrograms(f.limitMcg)}
                            </p>
                          </div>
                        </div>

                        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
                          <div
                            className={`h-full rounded-full ${meta.bar}`}
                            style={{ width: `${Math.min(100, pct)}%` }}
                          />
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          {pct}% of the limit{f.lifeStageRow ? ` for "${f.lifeStageRow}"` : ''}
                        </p>

                        <p className="mt-3 text-sm leading-relaxed text-slate-300">{f.detail}</p>
                        {f.sources.length > 0 && (
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {f.sources.map((s, j) => (
                              <span
                                key={j}
                                className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[0.7rem] text-slate-400"
                              >
                                {s}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {informational.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                    Also checked
                  </h3>
                  {informational.map((f, i) => (
                    <div
                      key={i}
                      className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-300"
                    >
                      <p className="font-medium text-slate-200">{f.nutrient}</p>
                      <p className="mt-1 leading-relaxed text-slate-400">{f.detail}</p>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
