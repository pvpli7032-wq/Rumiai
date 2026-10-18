import { NextRequest, NextResponse } from 'next/server';
import { DEFAULT_LOCALE, isLocale, SITE_URL } from '@/lib/i18n';
import {isMaintenanceProtectedWrite} from '@/lib/operations/maintenance-routing';
import {logRouteError} from '@/lib/logger';

/**
 * The live site has no locale-less pages: / redirects into /{locale}. Only the
 * public marketing routes are localised for now, so the existing signed-in app
 * paths (/discover, /chat, …) are left alone until they move under the segment too.
 */
const LOCALISED_ROOTS = ['', 'about', 'explore', 'terms-and-policy', 'character', 'auth'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Belt and braces alongside the matcher below. A locale redirect on an API path
  // turns a JSON call into an HTML 404, because fetch follows the redirect — which
  // is how the economy stress script started failing on CI while returning a
  // rendered not-found page for /api/users/me.
  if (pathname.startsWith('/api') || pathname.startsWith('/_next')) {
    if(isMaintenanceProtectedWrite(pathname,request.method)){
      try{
        const {readPublicMaintenance}=await import('@/lib/operations/maintenance-service');
        const policy=await readPublicMaintenance();
        if(policy.enabled)return NextResponse.json({error:policy.message,code:'MAINTENANCE_MODE'},{status:503,headers:{'Cache-Control':'no-store','Retry-After':String(policy.retryAfterSeconds)}});
      }catch(error){
        logRouteError('maintenance_write_gate',error);
        return NextResponse.json({error:'暂时无法提交操作，请稍后重试。',code:'MAINTENANCE_STATUS_UNAVAILABLE'},{status:503,headers:{'Cache-Control':'no-store','Retry-After':'60'}});
      }
    }
    return NextResponse.next();
  }

  // Every request lands on DEFAULT_LOCALE. The locale cookie this used to read was never
  // written anywhere, so the lookup only ever fell through to the default.
  if (pathname === '/') {
    const url = new URL(`/${DEFAULT_LOCALE}${request.nextUrl.search}`, SITE_URL);
    return NextResponse.redirect(url);
  }

  // A known root without a locale prefix, e.g. /explore -> /th/explore.
  const [, first] = pathname.split('/');
  if (first && !isLocale(first) && LOCALISED_ROOTS.includes(first)) {
    const url = new URL(`/${DEFAULT_LOCALE}${pathname}${request.nextUrl.search}`, SITE_URL);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  runtime:'nodejs',
  // API matching is explicit so file extensions cannot bypass business-write protection.
  matcher: ['/api/:path*','/((?!api|_next|.*\\..*).*)'],
};
