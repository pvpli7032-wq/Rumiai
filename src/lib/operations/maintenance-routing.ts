// Only these established administration workflows bypass the business-write gate.
// Their own domain services continue to enforce authentication and fine-grained permissions.
// Administration handlers all live under /api/admin now. Middleware sees the request
// path before next.config.mjs rewrites it, so the legacy roots below must stay listed
// for the compatibility window; otherwise old-prefix writes are blocked in maintenance
// mode even though the rewrites still route them. Remove them once nothing calls the
// old prefixes (the same condition for dropping the afterFiles rewrites).
const administrationRoots = [
  '/api/admin',
  '/api/finance', '/api/moderation',
  '/api/accounts/management', '/api/characters/management', '/api/circles/management',
];
const continuingEndpoints = new Set([
  '/api/auth/login', '/api/auth/logout',
]);

export function isMaintenanceProtectedWrite(pathname: string, method: string) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())) return false;
  const path = pathname.replace(/\/+$/, '');
  if (!path.startsWith('/api/')) return false;
  if (continuingEndpoints.has(path)) return false;
  return !administrationRoots.some(root => path === root || path.startsWith(root + '/'));
}
