import { NextRequest, NextResponse } from 'next/server';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n';

/**
 * The live site has no locale-less pages: / redirects into /{locale}. Only the
 * public marketing routes are localised for now, so the existing signed-in app
 * paths (/discover, /chat, …) are left alone until they move under the segment too.
 */
const LOCALISED_ROOTS = ['', 'about', 'explore', 'terms-and-policy', 'character', 'auth'];

function preferredLocale(request: NextRequest): Locale {
  const cookie = request.cookies.get('khuiai_locale')?.value;
  if (cookie && isLocale(cookie)) return cookie;

  return DEFAULT_LOCALE;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Belt and braces alongside the matcher below. A locale redirect on an API path
  // turns a JSON call into an HTML 404, because fetch follows the redirect — which
  // is how the economy stress script started failing on CI while returning a
  // rendered not-found page for /api/users/me.
  if (pathname.startsWith('/api') || pathname.startsWith('/_next')) {
    return NextResponse.next();
  }

  if (pathname === '/') {
    const url = request.nextUrl.clone();
    url.pathname = `/${preferredLocale(request)}`;
    return NextResponse.redirect(url);
  }

  // A known root without a locale prefix, e.g. /explore -> /th/explore.
  const [, first] = pathname.split('/');
  if (first && !isLocale(first) && LOCALISED_ROOTS.includes(first)) {
    const url = request.nextUrl.clone();
    url.pathname = `/${preferredLocale(request)}${pathname}`;
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Skip API routes, Next internals and anything with a file extension.
  matcher: ['/((?!api|_next|.*\\..*).*)'],
};
