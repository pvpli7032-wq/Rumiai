import type { NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';

const name = 'xingban_media_session';
/** Supplementary HttpOnly credential for image GETs; mutation APIs remain Bearer-only. */
export function setMediaSessionCookie(response: NextResponse, token: string | null) {
  response.cookies.set(name, token ?? '', {
    httpOnly: true, sameSite: 'lax', secure: (process.env.NEXT_PUBLIC_SITE_URL ?? '').startsWith('https:'),
    path: '/', maxAge: token ? 7 * 86400 : 0,
  });
  return response;
}

export async function getMediaAuthUser(request: Request) {
  if (request.headers.has('authorization')) return getAuthUser(request);
  const entry = (request.headers.get('cookie') ?? '').split(';').map(value => value.trim()).find(value => value.startsWith(name + '='));
  if (!entry) return null;
  let token: string;
  try { token = decodeURIComponent(entry.slice(name.length + 1)); } catch { return null; }
  if (!/^[A-Za-z0-9._-]{1,2000}$/.test(token)) return null;
  const headers = new Headers(request.headers); headers.set('authorization', `Bearer ${token}`);
  return getAuthUser(new Request(request, { headers }));
}
