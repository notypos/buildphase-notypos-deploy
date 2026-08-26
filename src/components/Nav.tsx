import Link from 'next/link';
import { getUser } from '@/lib/supabase/server';

export default async function Nav() {
  const user = await getUser();

  return (
    <nav className="border-b border-slate-200">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-3">
        <Link href="/" className="font-bold tracking-tight text-slate-900">
          ClearLabel
        </Link>
        <div className="flex items-center gap-4 text-sm">
          <Link href="/scan" className="text-slate-600 hover:text-teal-700">
            Scan
          </Link>
          {user ? (
            <>
              <Link href="/stack" className="text-slate-600 hover:text-teal-700">
                My Stack
              </Link>
              <Link href="/cards" className="text-slate-600 hover:text-teal-700">
                Saved
              </Link>
              <span className="hidden text-slate-400 sm:inline">{user.email}</span>
              <form action="/auth/signout" method="post">
                <button type="submit" className="text-slate-600 hover:text-teal-700">
                  Sign out
                </button>
              </form>
            </>
          ) : (
            <Link href="/login" className="font-medium text-teal-700 hover:underline">
              Sign in
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}
