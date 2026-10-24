import {NextResponse} from 'next/server';
import {forbidden, privateHeaders, requireAdmin, unauthorized} from '@rumiai/backend/infrastructure/http';
import {listReferralRelationships, ReferralError} from '@rumiai/backend/modules/referrals/service';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const access = await requireAdmin(request, 'growth.read');
  if (!access.ok) return access.reason === 'anonymous' ? unauthorized() : forbidden('没有查看邀请关系的权限。');
  try { const query = new URL(request.url).searchParams; return NextResponse.json(await listReferralRelationships({q: query.get('q') ?? '', page: Number(query.get('page') ?? 1)}), {headers: privateHeaders}); }
  catch (error) { return NextResponse.json({error: error instanceof ReferralError ? error.message : '邀请关系读取失败。'}, {status: error instanceof ReferralError ? error.status : 500, headers: privateHeaders}); }
}
