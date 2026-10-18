import { NextResponse } from 'next/server';
import { logRouteError } from '@/lib/logger';
import { readFinanceReport } from '@/lib/payments/reconciliation-service';
import { getFinanceAdmin } from '@/lib/payments/finance-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const access = await getFinanceAdmin(request);
    if (!access.user) return NextResponse.json({ error: access.error }, { status: access.status });
    const daysText = new URL(request.url).searchParams.get('days') ?? '7';
    if (!/^(?:[1-9]|[1-8][0-9]|90)$/.test(daysText)) return NextResponse.json({ error: '统计天数必须为 1–90 的整数。' }, { status: 400 });
    return NextResponse.json(await readFinanceReport(Number(daysText)), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    logRouteError('GET /api/admin/finance/report', error);
    return NextResponse.json({ error: '财务报告加载失败。' }, { status: 500 });
  }
}
