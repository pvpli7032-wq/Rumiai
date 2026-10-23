import {NextRequest, NextResponse} from 'next/server';
import {isMaintenanceProtectedWrite} from '@rumiai/backend/modules/operations/maintenance-routing';
import {readPublicMaintenance} from '@rumiai/backend/modules/operations/maintenance-service';
import {logRouteError} from '@rumiai/backend/infrastructure/logging/logger';

/** API-only safety gate. Locale redirects belong to the web app and must never run here. */
export async function middleware(request: NextRequest) {
  if (!isMaintenanceProtectedWrite(request.nextUrl.pathname, request.method)) return NextResponse.next();
  try {
    const policy = await readPublicMaintenance();
    if (!policy.enabled) return NextResponse.next();
    return NextResponse.json({error: policy.message, code: 'MAINTENANCE_MODE'}, {status: 503, headers: {'Cache-Control': 'no-store', 'Retry-After': String(policy.retryAfterSeconds)}});
  } catch (error) {
    logRouteError('maintenance_write_gate', error);
    return NextResponse.json({error: '暂时无法提交操作，请稍后重试。', code: 'MAINTENANCE_STATUS_UNAVAILABLE'}, {status: 503, headers: {'Cache-Control': 'no-store', 'Retry-After': '60'}});
  }
}

export const config = {runtime: 'nodejs', matcher: ['/api/:path*']};
