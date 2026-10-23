// Only established administration workflows bypass the business-write gate; their own
// domain services still enforce authentication and fine-grained permissions.
// The compatibility window is over: every handler lives under /api/admin and the old
// prefixes no longer reach a route, so there is nothing else to exempt here.
import { API } from '@rumiai/contracts/api-paths';

const administrationRoots = ['/api/admin'];
const continuingEndpoints = new Set<string>([
  API.auth.login, API.auth.logout,
]);

export function isMaintenanceProtectedWrite(pathname: string, method: string) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())) return false;
  const path = pathname.replace(/\/+$/, '');
  if (!path.startsWith('/api/')) return false;
  if (continuingEndpoints.has(path)) return false;
  return !administrationRoots.some(root => path === root || path.startsWith(root + '/'));
}
