import {NextResponse} from 'next/server';
import {forbidden, privateHeaders, requireAdmin, unauthorized} from '@rumiai/backend/infrastructure/http';
import {AffiliateError, listAffiliateLedger, readAffiliatePolicy} from '@rumiai/backend/modules/affiliate/service';

export const dynamic = 'force-dynamic';
function denied(reason: string) {return reason === 'anonymous' ? unauthorized() : forbidden('没有分销配置权限。');}
export async function GET(request: Request) {
  const access = await requireAdmin(request, 'growth.read'); if (!access.ok) return denied(access.reason);
  try { const q = new URL(request.url).searchParams; return NextResponse.json({policy: await readAffiliatePolicy(), ledger: await listAffiliateLedger({status: q.get('status') ?? undefined, page: Number(q.get('page') ?? 1)})}, {headers: privateHeaders}); }
  catch (error) { return NextResponse.json({error: error instanceof AffiliateError ? error.message : '分销数据读取失败。'}, {status: error instanceof AffiliateError ? error.status : 500, headers: privateHeaders}); }
}
