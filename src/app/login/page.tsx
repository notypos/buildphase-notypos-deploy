'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

type Mode = 'signin' | 'signup';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') ?? '/stack';

  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setNotice(null);

    const supabase = createClient();

    if (mode === 'signup') {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${next}` },
      });
      if (error) {
        setError(error.message);
      } else if (data.session) {
        // Email confirmation is off — the user is signed in already.
        router.push(next);
        router.refresh();
      } else {
        setNotice('Check your email for a confirmation link, then sign in.');
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setError(
          error.message === 'Invalid login credentials'
            ? 'That email and password combination did not match an account.'
            : error.message,
        );
      } else {
        router.push(next);
        router.refresh();
      }
    }
    setLoading(false);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-10">
      <section className="rounded-lg border border-white/10 bg-white/[0.04] p-6 shadow-2xl shadow-black/25">
        <Link href="/" className="mb-8 flex items-center gap-3 text-xl font-bold text-white">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-[#8f6cff] to-[#5b3fd6] text-sm text-white">
            CL
          </span>
          ClearLabel
        </Link>

        <h1 className="mb-1 text-2xl font-semibold text-white">
          {mode === 'signin' ? 'Sign in' : 'Create an account'}
        </h1>
        <p className="mb-6 text-sm leading-relaxed text-slate-400">
          An account lets you save what you take and run safety checks against it. Asking
          questions never requires one.
        </p>

        <form onSubmit={submit} className="space-y-3">
        <div>
          <label htmlFor="email" className="mb-1 block text-sm font-medium text-slate-200">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-white/10 bg-[#081221] px-3 py-2.5 text-white outline-none transition focus:border-violet-300/55 focus:ring-2 focus:ring-violet-400/20"
          />
        </div>

        <div>
          <label htmlFor="password" className="mb-1 block text-sm font-medium text-slate-200">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={8}
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-white/10 bg-[#081221] px-3 py-2.5 text-white outline-none transition focus:border-violet-300/55 focus:ring-2 focus:ring-violet-400/20"
          />
          {mode === 'signup' && (
            <p className="mt-1 text-xs text-slate-500">At least 8 characters.</p>
          )}
        </div>

        {error && (
          <p role="alert" className="rounded-lg border border-red-300/25 bg-red-300/10 px-3 py-2 text-sm text-red-100">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="rounded-lg border border-teal-300/25 bg-teal-300/[0.08] px-3 py-2 text-sm text-teal-100">
            {notice}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-gradient-to-r from-[#7557f8] to-[#32d1b0] px-4 py-2.5 font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45"
        >
          {loading ? 'Working...' : mode === 'signin' ? 'Sign in' : 'Create account'}
        </button>
        </form>

        <p className="mt-5 text-sm text-slate-400">
          {mode === 'signin' ? "Don't have an account? " : 'Already have one? '}
          <button
            onClick={() => {
              setMode(mode === 'signin' ? 'signup' : 'signin');
              setError(null);
              setNotice(null);
            }}
            className="font-semibold text-teal-100 hover:text-white"
          >
            {mode === 'signin' ? 'Create one' : 'Sign in'}
          </button>
        </p>

        <Link href="/ask" className="mt-8 inline-block text-sm font-medium text-slate-500 hover:text-teal-100">
          Ask a question without an account
        </Link>
      </section>
    </main>
  );
}

export default function LoginPage() {
  // useSearchParams needs a Suspense boundary for static prerendering.
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
