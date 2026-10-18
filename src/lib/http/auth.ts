import {getAuthUser, type JWTPayload} from '@/lib/auth';
import {hasAdminPermission} from '@/lib/admin/authorization';
import type {AdminPermission} from '@/lib/admin/permissions';

/** Signed-in caller of a request, or null when the Bearer token is absent or dead. */
export type AuthenticatedUser = JWTPayload;

export type AdminAccess = {ok: true; user: JWTPayload} | {ok: false; reason: 'anonymous' | 'forbidden'};

/** Resolve the caller from the Bearer token; `null` means "not signed in". */
export async function requireUser(request: Request): Promise<AuthenticatedUser | null> {
  return getAuthUser(request);
}

/**
 * Resolve the caller and check one administration permission. The two failure
 * kinds stay distinguishable so a route can answer 401 to a missing session and
 * 403 to an account that is signed in without the permission.
 */
export async function requireAdmin(request: Request, permission: AdminPermission): Promise<AdminAccess> {
  const user = await getAuthUser(request);
  if (!user) return {ok: false, reason: 'anonymous'};
  return (await hasAdminPermission(user.userId, permission)) ? {ok: true, user} : {ok: false, reason: 'forbidden'};
}
