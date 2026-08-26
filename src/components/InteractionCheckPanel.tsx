'use client';

import { useRef, useState } from 'react';

interface Medication {
  id: string;
  name: string;
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
}

function parseNames(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Free-typed (or scanned) supplement names checked against selected saved
 * medications, grounded in retrieved NIH fact sheet text — see
 * src/lib/rag/interactions.ts. Separate from the dose-safety check above:
 * this is about interaction claims in free text, not a dose-vs-limit sum.
 */
export default function InteractionCheckPanel({ medications }: { medications: Medication[] }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [namesText, setNamesText] = useState('');
  const [scanning, setScanning] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InteractionResult | null>(null);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function onScanFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setScanning(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('image', file);
      const res = await fetch('/api/scan', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? 'Could not read that label.');
        return;
      }
      const found: string[] = data.readable
        ? [data.productName, ...(data.items ?? []).map((i: { labelName: string }) => i.labelName)].filter(Boolean)
        : [];
      if (found.length === 0) {
        setError("Couldn't read a supplement name from that photo.");
        return;
      }
      setNamesText((prev) => (prev.trim() ? `${prev.trim()}, ${found.join(', ')}` : found.join(', ')));
    } catch {
      setError('Could not read that photo. Try again.');
    } finally {
      setScanning(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function runCheck() {
    const supplementNames = parseNames(namesText);
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

  return (
    <div className="mt-6 space-y-4 rounded-xl border border-slate-200 p-5">
      <div>
        <h3 className="mb-1 text-xs font-bold tracking-wide text-slate-500 uppercase">
          Check supplements against your medications
        </h3>
        <p className="text-sm text-slate-600">
          Type in supplements to check, or scan a label to add one, then pick which medications to
          check them against.
        </p>
      </div>

      {medications.length === 0 ? (
        <p className="text-sm text-slate-500">Add a medication above first.</p>
      ) : (
        <fieldset className="space-y-1.5">
          <legend className="mb-1 text-sm font-medium text-slate-700">Medications to check</legend>
          {medications.map((m) => (
            <label key={m.id} className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={selected.has(m.id)}
                onChange={() => toggle(m.id)}
                className="h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600"
              />
              {m.name}
            </label>
          ))}
        </fieldset>
      )}

      <div>
        <label htmlFor="interaction-names" className="mb-1 block text-sm font-medium text-slate-700">
          Supplements to check (comma or new line separated)
        </label>
        <textarea
          id="interaction-names"
          value={namesText}
          onChange={(e) => setNamesText(e.target.value)}
          placeholder="e.g. Vitamin K, St. John's Wort"
          rows={2}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-teal-600 focus:ring-1 focus:ring-teal-600"
        />
        <div className="mt-2 flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={onScanFile}
            className="hidden"
            id="interaction-scan-input"
          />
          <label
            htmlFor="interaction-scan-input"
            className="cursor-pointer rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-teal-500 hover:text-teal-700"
          >
            {scanning ? 'Reading…' : '📷 Scan to add a name'}
          </label>
        </div>
      </div>

      <button
        type="button"
        onClick={runCheck}
        disabled={checking || parseNames(namesText).length === 0 || selected.size === 0}
        className="rounded-lg bg-teal-700 px-3.5 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        {checking ? 'Checking…' : 'Check for interactions'}
      </button>

      {error && <p className="text-sm text-red-700">{error}</p>}

      {result && (
        <div className="space-y-2">
          <p className="text-sm text-slate-700">{result.summary}</p>
          {result.uncovered.length > 0 && (
            <p className="text-xs text-slate-500">
              Not covered by an NIH fact sheet: {result.uncovered.join(', ')}
            </p>
          )}
          {result.findings.map((f, i) => (
            <div
              key={i}
              className={`rounded-lg border p-3 text-sm ${
                f.flagged ? 'border-red-300 bg-red-50 text-red-900' : 'border-slate-200 bg-slate-50 text-slate-600'
              }`}
            >
              <p className="font-semibold">
                {f.flagged ? '⚠️ Mentioned' : 'Not mentioned'} · {f.supplement} + {f.medication}
              </p>
              <p className="mt-1">{f.detail}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
