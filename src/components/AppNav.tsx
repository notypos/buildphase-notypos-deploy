'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { href: '/', label: 'Home', mark: '⌂' },
  { href: '/ask', label: 'Ask', mark: '?' },
  { href: '/scan', label: 'Scan', mark: '+' },
  { href: '/stack', label: 'My Stack', mark: '▤' },
  { href: '/learn', label: 'Learn', mark: '◎' },
] as const;

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-3" aria-label="ClearLabel home">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-[#8f6cff] to-[#5b3fd6] text-sm font-bold text-white shadow-lg shadow-violet-950/40">
        CL
      </span>
      <span className="text-lg font-semibold text-white">ClearLabel</span>
    </Link>
  );
}

function NihBadge({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border border-violet-300/20 bg-violet-400/10 font-medium text-violet-100 ${
        compact ? 'px-2.5 py-1 text-[0.7rem]' : 'px-3 py-1.5 text-xs'
      }`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-clear-verified" />
      {compact ? 'NIH-backed' : 'Evidence-first. NIH-backed.'}
    </span>
  );
}

export default function AppNav({ userEmail }: { userEmail: string | null }) {
  const pathname = usePathname();
  const profileHref = userEmail ? '/cards' : '/login';

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#07111f]/[0.88] backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-3 md:px-8">
          <div className="flex items-center gap-8">
            <Logo />
            <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
              {NAV_ITEMS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`relative rounded-md px-3 py-2 text-sm font-medium transition ${
                    isActive(item.href)
                      ? 'text-white after:absolute after:right-3 after:-bottom-1 after:left-3 after:h-0.5 after:rounded-full after:bg-clear-accent'
                      : 'text-slate-400 hover:bg-white/5 hover:text-slate-100'
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden sm:block">
              <NihBadge />
            </div>
            {userEmail ? (
              <>
                <Link
                  href="/cards"
                  title={userEmail}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.07] text-xs font-semibold text-slate-200 transition hover:border-violet-300/40 hover:text-white"
                >
                  {userEmail.slice(0, 2).toUpperCase()}
                </Link>
                <form action="/auth/signout" method="post" className="hidden md:block">
                  <button
                    type="submit"
                    className="rounded-md px-3 py-2 text-sm font-medium text-slate-400 transition hover:bg-white/5 hover:text-white"
                  >
                    Sign out
                  </button>
                </form>
              </>
            ) : (
              <Link
                href="/login"
                className="rounded-md border border-white/10 bg-white/[0.07] px-3.5 py-2 text-sm font-medium text-white transition hover:border-violet-300/40 hover:bg-white/10"
              >
                Sign in
              </Link>
            )}
          </div>
        </div>
      </header>

      <nav
        aria-label="Mobile primary"
        className="fixed right-0 bottom-0 left-0 z-50 border-t border-white/10 bg-[#07111f]/[0.94] px-3 pb-3 pt-2 backdrop-blur-xl md:hidden"
      >
        <div className="mx-auto grid max-w-md grid-cols-5 items-end gap-1">
          {NAV_ITEMS.slice(0, 4).map((item) => {
            const active = isActive(item.href);
            const center = item.href === '/scan';
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex flex-col items-center justify-center gap-1 rounded-lg px-2 py-2 text-[0.7rem] font-medium transition ${
                  active ? 'text-white' : 'text-slate-500 hover:text-slate-200'
                }`}
              >
                <span
                  className={`flex items-center justify-center ${
                    center
                      ? 'h-11 w-11 rounded-lg bg-gradient-to-br from-[#8f6cff] to-[#32d1b0] text-xl font-bold text-white shadow-lg shadow-violet-950/50'
                      : 'h-7 w-7 rounded-md border border-white/10 bg-white/5 text-sm'
                  }`}
                >
                  {item.mark}
                </span>
                <span>{item.href === '/stack' ? 'Stack' : item.label}</span>
              </Link>
            );
          })}
          <Link
            href={profileHref}
            className={`flex flex-col items-center justify-center gap-1 rounded-lg px-2 py-2 text-[0.7rem] font-medium transition ${
              pathname === profileHref || pathname.startsWith('/cards') || pathname.startsWith('/login')
                ? 'text-white'
                : 'text-slate-500 hover:text-slate-200'
            }`}
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-white/5 text-[0.65rem]">
              {userEmail ? userEmail.slice(0, 2).toUpperCase() : '•'}
            </span>
            <span>Profile</span>
          </Link>
        </div>
      </nav>
    </>
  );
}
