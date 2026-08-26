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
    <main className="mx-auto min-h-screen max-w-4xl px-5 py-8 md:px-8 md:py-12">
      <div className="mb-8">
        <p className="mb-3 text-sm font-semibold text-clear-verified">Environment diagnostics</p>
        <h1 className="text-3xl font-bold text-white md:text-5xl">Health check</h1>
        <p className="mt-3 max-w-3xl text-base leading-relaxed text-slate-300">
          Verifies that each configured secret actually works in this environment, not just that it
          is set. No secret values are shown.
        </p>
      </div>

      {fetchError && (
        <p className="rounded-lg border border-red-300/25 bg-red-300/10 p-5 text-red-100">
          Could not reach the check: {fetchError}
        </p>
      )}

      {data && (
        <>
          <div
            className={`mb-5 rounded-lg border p-5 ${
              data.ok
                ? 'border-teal-300/25 bg-teal-300/[0.08] text-teal-50'
                : 'border-red-300/25 bg-red-300/10 text-red-50'
            }`}
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

          <ul className="divide-y divide-white/10 rounded-lg border border-white/10 bg-white/[0.04]">
            {data.checks.map((c) => (
              <li key={c.name} className="flex items-start gap-3 px-5 py-3">
                <span
                  className={`mt-0.5 shrink-0 rounded-md px-1.5 py-0.5 text-xs font-bold ${
                    c.ok ? 'bg-teal-300/[0.15] text-teal-100' : 'bg-red-300/[0.15] text-red-100'
                  }`}
                >
                  {c.ok ? 'PASS' : 'FAIL'}
                </span>
                <span className="flex-1">
                  <span className="font-medium text-slate-100">{c.name}</span>
                  {c.detail && <span className="block text-sm text-slate-500">{c.detail}</span>}
                </span>
              </li>
            ))}
          </ul>

          {!data.deep && (
            <a
              href="/health?deep=1"
              className="mt-5 inline-block rounded-md bg-gradient-to-r from-[#7557f8] to-[#32d1b0] px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110"
            >
              Run deep check (calls Gemini + Trussed)
            </a>
          )}
        </>
      )}
    </main>
  );
}
