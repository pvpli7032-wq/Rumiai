import { NextResponse } from 'next/server';
import { logRouteError } from '@rumiai/backend/infrastructure/logging/logger';
import { getAuthUser } from '@rumiai/backend/infrastructure/auth/auth';
import { CommunityReportError, listOwnReports, submitReport } from '@rumiai/backend/modules/community/report-service';

export const dynamic='force-dynamic';

/** The reporter's own filings. Nobody else's reports are visible here. */
export async function GET(request: Request) {
  try {
    const authUser = await getAuthUser(request);
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const reports = await listOwnReports(authUser.userId);

    return NextResponse.json(reports,{headers:{'Cache-Control':'private, no-store'}});
  } catch (error) {
    logRouteError('GET /api/reports', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * File a report. A platform carrying adult user-generated content has to have a way to
 * hear about illegal material, so this stays deliberately easy to reach — but a second
 * report from the same person about the same thing updates the first rather than
 * stacking up, so one determined account cannot manufacture the appearance of many
 * complaints.
 */
export async function POST(request: Request) {
  try {
    const authUser = await getAuthUser(request);
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let body: unknown;
    try { body = await request.json(); } catch { return NextResponse.json({ error: '举报数据格式不正确。' }, { status: 400 }); }
    const result = await submitReport(authUser.userId, body);
    return NextResponse.json(result, { status: result.updated ? 200 : 201 });

  } catch (error) {
    if (error instanceof CommunityReportError) {
      const headers = error.retryAfter === undefined ? undefined : { 'Retry-After': String(error.retryAfter) };
      return NextResponse.json({ error: error.message }, { status: error.status, headers });
    }
    logRouteError('POST /api/reports', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
