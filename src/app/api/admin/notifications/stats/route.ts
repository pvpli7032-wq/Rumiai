import {NextResponse} from 'next/server';
import {db, pragmasReady} from '@/lib/db';
import {forbidden, jsonError, privateHeaders, requireAdmin, unauthorized} from '@/lib/http';
import {readNotificationStats} from '@/lib/notifications/stats';

export const dynamic = 'force-dynamic';

/** 通知统计：按类型汇总发送量、未读、已读；天数与运营分析同一上限。 */
export async function GET(request: Request) {
  const access = await requireAdmin(request, 'notifications.read');
  if (!access.ok) return access.reason === 'anonymous' ? unauthorized() : forbidden('只有具备通知记录查看权限的管理员可以查看通知统计。');
  const daysText = new URL(request.url).searchParams.get('days') ?? '7';
  if (!/^(?:[1-9]|[1-8][0-9]|90)$/.test(daysText)) {
    return NextResponse.json({error: '统计天数必须为 1–90 的整数。'}, {status: 400, headers: privateHeaders});
  }
  try {
    await pragmasReady;
    const days = Number(daysText);
    const until = new Date();
    const since = new Date(until.getTime() - days * 86_400_000);
    const report = await db.$transaction(tx => readNotificationStats(tx, since, until, days));
    return NextResponse.json(report, {headers: privateHeaders});
  } catch (error) {
    return jsonError(error, 'GET /api/admin/notifications/stats', '通知统计读取失败，请稍后重试。');
  }
}
