import type {NextResponse} from 'next/server';

export const ADMIN_SESSION_COOKIE = 'xingban_admin_session';

export function setAdminSessionCookie(response: NextResponse, token: string | null) {
  response.cookies.set(ADMIN_SESSION_COOKIE, token ?? '', {
    httpOnly: true,
    sameSite: 'strict',
    secure: (process.env.NEXT_PUBLIC_SITE_URL ?? '').startsWith('https:'),
    // The console pages live at /admin while their API is under /api/admin.
    // A root path is required so the browser sends this admin-only cookie to
    // both surfaces; the distinct name keeps it separate from the storefront.
    path: '/',
    maxAge: token ? 8 * 60 * 60 : 0,
  });
  return response;
}

/** Cookie-authenticated writes reject cross-site browser requests. */
export function isAdminOriginAllowed(request: Request) {
  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite && !['same-origin', 'same-site', 'none'].includes(fetchSite)) return false;
  if (!origin) return true;
  const allowed = new Set<string>([new URL(request.url).origin]);
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    try { allowed.add(new URL(process.env.NEXT_PUBLIC_SITE_URL).origin); } catch { /* invalid config is simply not trusted */ }
  }
  return allowed.has(origin);
}

export function readAdminSessionCookie(request: Request): string | null {
  const entry = (request.headers.get('cookie') ?? '').split(';').map(value => value.trim()).find(value => value.startsWith(ADMIN_SESSION_COOKIE + '='));
  if (!entry) return null;
  try {
    const token = decodeURIComponent(entry.slice(ADMIN_SESSION_COOKIE.length + 1));
    return /^[A-Za-z0-9_-]{40,200}$/.test(token) ? token : null;
  } catch {
    return null;
  }
}
