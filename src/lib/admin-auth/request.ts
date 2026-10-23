import type {JWTPayload} from '@/lib/auth';
import {getAdminAuthUser} from './service';
import {isAdminOriginAllowed, readAdminSessionCookie} from './cookies';

/** Resolve only the administration HttpOnly session for an admin API request. */
export async function getAdminRequestUser(request: Request): Promise<JWTPayload | null> {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !isAdminOriginAllowed(request)) return null;
  try { return await getAdminAuthUser(readAdminSessionCookie(request)); } catch { return null; }
}
