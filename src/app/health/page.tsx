import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Health — ClearLabel' };

interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}

export default async function HealthPage({
  searchParams,
}: {
  searchParams: Promise<{ deep?: string }>;
}) {
  const { deep } = await searchParams;
  const h = await headers();
  const host = h.get('host');
  const proto = host?.startsWith('localhost') ? 'http' : 'https';

  let data: { ok: boolean; deep: boolean; checks: Check[] } | null = null;
  let fetchError: string | null = null;

  try {
    const res = await fetch(`${proto}://${host}/api/health${deep === '1' ? '?deep=1' : ''}`, {
      cache: 'no-store',
    });
    data = await res.json();
  } catch (e) {
    fetchError = String(e).slice(0, 200);
  }

  return (
    <main className="mx-auto max-w-3xl px-5 py-10">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">Health check</h1>
      <p className="mt-1 mb-6 text-slate-600">
        Verifies that each configured secret actually works in this environment — not just that
        it is set. No secret values are shown.
      </p>

      {fetchError && (
        <p className="rounded-xl bg-red-50 p-5 text-red-800">Could not reach the check: {fetchError}</p>
      )}

      {data && (
        <>
          <div
            className={`mb-5 rounded-xl p-5 ${data.ok ? 'bg-teal-50 text-teal-900' : 'bg-red-50 text-red-900'}`}
          >
            <p className="text-lg font-semibold">
              {data.ok ? 'All checks passed' : 'Something is misconfigured'}
            </p>
            <p className="mt-0.5 text-sm opacity-80">
              {data.deep
                ? 'Including live embedding and generation calls.'
                : 'Configuration and database only — add ?deep=1 to also call the AI providers.'}
            </p>
          </div>

          <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200">
            {data.checks.map((c) => (
              <li key={c.name} className="flex items-start gap-3 px-5 py-3">
                <span
                  className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-xs font-bold ${
                    c.ok ? 'bg-teal-100 text-teal-800' : 'bg-red-100 text-red-800'
                  }`}
                >
                  {c.ok ? 'PASS' : 'FAIL'}
                </span>
                <span className="flex-1">
                  <span className="font-medium text-slate-800">{c.name}</span>
                  {c.detail && <span className="block text-sm text-slate-500">{c.detail}</span>}
                </span>
              </li>
            ))}
          </ul>

          {!data.deep && (
            <a
              href="/health?deep=1"
              className="mt-5 inline-block rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800"
            >
              Run deep check (calls Gemini + Trussed)
            </a>
          )}
        </>
      )}
    </main>
  );
}
