import { NextRequest, NextResponse } from 'next/server';
import { DEFAULT_LOCALE, isLocale } from '@web/lib/i18n';

/**
 * The app has one discover entry for anonymous and signed-in readers. Legacy
 * marketing/catalogue URLs are compatibility redirects; other public business
 * pages keep their locale routes.
 */
const LOCALISED_ROOTS = ['about', 'terms-and-policy', 'auth', 'disputes', 'mirror'];

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

  const segments = pathname.split('/').filter(Boolean);
  const publicSegments = segments[0] && isLocale(segments[0]) ? segments.slice(1) : segments;
  if (publicSegments.length === 0) {
    const url = new URL(`/discover${request.nextUrl.search}`, publicOrigin(request));
    return NextResponse.redirect(url, 308);
  }
  if (publicSegments.length === 1 && publicSegments[0] === 'explore') {
    const url = new URL(`/discover${request.nextUrl.search}`, publicOrigin(request));
    url.searchParams.set('view', 'characters');
    if (!url.searchParams.has('q') && url.searchParams.has('search')) url.searchParams.set('q', url.searchParams.get('search')!);
    const types = [...new Set([...url.searchParams.getAll('type'), ...url.searchParams.getAll('tag')]
      .flatMap(value => value.split(',')).map(value => value.trim()).filter(Boolean))];
    if (types.length) url.searchParams.set('type', types.join(','));
    else url.searchParams.delete('type');
    url.searchParams.delete('search');
    url.searchParams.delete('tag');
    return NextResponse.redirect(url, 308);
  }
  if (publicSegments.length === 2 && publicSegments[0] === 'character') {
    const url = new URL(`/discover${request.nextUrl.search}`, publicOrigin(request));
    // Decode the URL segment once, then let searchParams encode the selected ID.
    let characterId = publicSegments[1];
    try { characterId = decodeURIComponent(characterId); } catch { /* Preserve an invalid raw segment for the API error path. */ }
    url.searchParams.set('character', characterId);
    return NextResponse.redirect(url, 308);
  }

  // Business/public pages such as /about retain their locale aliases.
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
