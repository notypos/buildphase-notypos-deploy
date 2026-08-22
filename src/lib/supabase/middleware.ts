import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/** Routes that require a signed-in user. Ask stays public by design. */
const PROTECTED = ['/stack', '/cards', '/account'];

/**
 * Refreshes the Supabase session cookie on every request and gates protected
 * routes.
 *
 * The cookie dance is fussy and order-dependent: cookies must be written to BOTH
 * the request (so `getUser()` below sees them) and the response (so the browser
 * keeps them). Returning a different response object than the one the cookies
 * were set on silently logs users out on refresh.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          toSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  // Must be getUser(), not getSession(): getSession() trusts the cookie without
  // verifying it against the auth server, so a forged cookie would pass.
  const { data: { user } } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  if (!user && PROTECTED.some((p) => path.startsWith(p))) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', path); // return them where they were headed
    return NextResponse.redirect(url);
  }

  if (user && path === '/login') {
    const url = request.nextUrl.clone();
    url.pathname = '/stack';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}
