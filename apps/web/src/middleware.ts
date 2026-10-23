import { NextRequest, NextResponse } from 'next/server';
import { DEFAULT_LOCALE, isLocale } from '@web/lib/i18n';

/**
 * The live site has no locale-less pages: / redirects into /{locale}. Only the
 * public marketing routes are localised for now, so the existing signed-in app
 * paths (/discover, /chat, …) are left alone until they move under the segment too.
 */
const LOCALISED_ROOTS = ['', 'about', 'explore', 'terms-and-policy', 'character', 'auth', 'disputes', 'mirror'];

/**
 * The origin a browser should be sent to. Derived from the request rather than from
 * NEXT_PUBLIC_SITE_URL: Next inlines NEXT_PUBLIC_* at build time, so a value that only
 * exists at runtime is silently ignored — which pointed every `/` redirect at
 * http://localhost:3000 on any instance not built with that variable. Behind the
 * production reverse proxy the forwarded host/proto are the public ones, i.e. the same
 * origin the build-time constant used to supply.
 */
function publicOrigin(request: NextRequest) {
  const host = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() || request.headers.get('host')?.trim();
  if (!host) return request.nextUrl.origin;
  const proto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || request.nextUrl.protocol.replace(':', '');
  return proto + '://' + host;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Belt and braces alongside the matcher below. A locale redirect on an API path
  // turns a JSON call into an HTML 404, because fetch follows the redirect — which
  // is how the economy stress script started failing on CI while returning a
  // rendered not-found page for /api/users/me.
  if (pathname.startsWith('/api') || pathname.startsWith('/_next')) {
    // API owns its maintenance write gate; the web app only forwards requests.
    return NextResponse.next();
  }

  // Every request lands on DEFAULT_LOCALE. The locale cookie this used to read was never
  // written anywhere, so the lookup only ever fell through to the default.
  if (pathname === '/') {
    const url = new URL(`/${DEFAULT_LOCALE}${request.nextUrl.search}`, publicOrigin(request));
    return NextResponse.redirect(url);
  }

  // A known root without a locale prefix, e.g. /explore -> /th/explore.
  const [, first] = pathname.split('/');
  if (first && !isLocale(first) && LOCALISED_ROOTS.includes(first)) {
    const url = new URL(`/${DEFAULT_LOCALE}${pathname}${request.nextUrl.search}`, publicOrigin(request));
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  runtime:'nodejs',
  matcher: ['/((?!api|_next|.*\\..*).*)'],
};
