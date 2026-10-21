import {NextResponse} from 'next/server';
import {closeAdminDisputeCase} from '@/lib/admin/dispute-cases-admin';
import {forbidden, jsonError, privateHeaders, requireAdmin, unauthorized} from '@/lib/http';

export const dynamic = 'force-dynamic';

type Context = {params: Promise<{id: string}>};

/** 立即结案：不等截止时间也不等票数，仍走一次角色回应。 */
export async function POST(request: Request, context: Context) {
  const access = await requireAdmin(request, 'disputes.manage');
  if (!access.ok) return access.reason === 'anonymous' ? unauthorized() : forbidden('只有具备评理管理权限的管理员可以结案。');
  const {id} = await context.params;
  try {
    return NextResponse.json(await closeAdminDisputeCase(id), {headers: privateHeaders});
  } catch (error) {
    return jsonError(error, 'POST /api/admin/disputes/cases/[id]/close', '结案失败，请稍后重试。');
  }
}
