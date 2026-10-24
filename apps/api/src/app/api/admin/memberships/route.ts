import { NextResponse } from 'next/server';
import { requireAdmin, privateHeaders, unauthorized, forbidden, readJsonBody } from '@rumiai/backend/infrastructure/http';
import { deleteMembershipPlan, readMembershipCatalogue, saveMembershipPlan, saveMembershipPolicy, MembershipError } from '@rumiai/backend/modules/memberships/service';
import {logRouteError} from '@rumiai/backend/infrastructure/logging/logger';
import type {MembershipAdminPlanInput,MembershipAdminPolicyInput} from '@rumiai/contracts/memberships';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const access = await requireAdmin(request, 'finance.read');
  if (!access.ok) return access.reason === 'anonymous' ? unauthorized() : forbidden('没有查看会员配置的权限。');
  try {
    return NextResponse.json(await readMembershipCatalogue(), { headers: privateHeaders });
  } catch(error) {
    logRouteError('GET /api/admin/memberships',error);
    return NextResponse.json({error:'会员配置暂不可用。'},{status:500,headers:privateHeaders});
  }
}

export async function PATCH(request: Request) {
  const access = await requireAdmin(request, 'finance.packages.write');
  if (!access.ok) return access.reason === 'anonymous' ? unauthorized() : forbidden('没有修改会员配置的权限。');
  const body = await readJsonBody(request, { maxBytes: 100_000 });
  if (body.response) return body.response;
  try {
    if(!body.input||typeof body.input!=='object'||Array.isArray(body.input))throw new MembershipError('请求数据格式不正确。');
    const input = body.input as Record<string, unknown>;
    if(typeof input.reason!=='string')throw new MembershipError('请填写操作理由。');
    if (input.kind === 'policy') {
      if(typeof input.refundWindowHours!=='number'||typeof input.usageChargePeriodHours!=='number'||typeof input.version!=='number')throw new MembershipError('退款规则参数格式不正确。');
      const result = await saveMembershipPolicy(access.user.userId, input as unknown as MembershipAdminPolicyInput);
      return NextResponse.json(result, { headers: privateHeaders });
    }
    if(typeof input.code!=='string'||typeof input.name!=='string'||typeof input.durationDays!=='number'||(input.priceCents!==null&&typeof input.priceCents!=='number')||typeof input.isActive!=='boolean'||!Array.isArray(input.benefits)||(input.id!==undefined&&typeof input.id!=='string')||(input.version!==undefined&&typeof input.version!=='number')||(input.sortOrder!==undefined&&typeof input.sortOrder!=='number'))throw new MembershipError('会员套餐参数格式不正确。');
    const result = await saveMembershipPlan(access.user.userId, input as unknown as MembershipAdminPlanInput);
    return NextResponse.json(result, { headers: privateHeaders });
  } catch (error) {
    if(error instanceof MembershipError)return NextResponse.json({error:error.message,code:error.code},{status:error.status,headers:privateHeaders});
    logRouteError('PATCH /api/admin/memberships',error);
    return NextResponse.json({error:'会员配置保存失败，请稍后重试。'}, {status:500, headers:privateHeaders});
  }
}

export async function DELETE(request: Request) {
  const access = await requireAdmin(request, 'finance.packages.write');
  if (!access.ok) return access.reason === 'anonymous' ? unauthorized() : forbidden('没有删除会员套餐的权限。');
  const body = await readJsonBody(request, {maxBytes: 10_000}); if (body.response) return body.response;
  try { return NextResponse.json(await deleteMembershipPlan(access.user.userId, body.input as never), {headers: privateHeaders}); }
  catch (error) { if (error instanceof MembershipError) return NextResponse.json({error: error.message, code: error.code}, {status: error.status, headers: privateHeaders}); throw error; }
}
