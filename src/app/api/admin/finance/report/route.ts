import {NextResponse} from 'next/server';
import {readFinanceReport} from '@/lib/payments/reconciliation-service';
import {getFinanceAdmin} from '@/lib/payments/finance-auth';
import {apiError, badRequest, jsonError, privateHeaders} from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const access = await getFinanceAdmin(request);
    if (!access.user) return apiError(access.status, access.error);
    const daysText = new URL(request.url).searchParams.get('days') ?? '7';
    if (!/^(?:[1-9]|[1-8][0-9]|90)$/.test(daysText)) return badRequest('统计天数必须为 1–90 的整数。');
    return NextResponse.json(await readFinanceReport(Number(daysText)), {headers: privateHeaders});
  } catch (error) {
    return jsonError(error, 'GET /api/admin/finance/report', '财务报告加载失败。');
  }
}
