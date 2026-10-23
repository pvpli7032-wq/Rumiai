import {NextResponse} from 'next/server';
import {getFinanceAdmin} from '@rumiai/backend/modules/payments/finance-auth';
import {updateManagedPackage,deleteManagedPackage} from '@rumiai/backend/modules/coins/package-management';
import {apiError, badRequest, jsonError, privateHeaders} from '@rumiai/backend/infrastructure/http';

export async function PUT(request: Request, {params: paramsPromise}: {params: Promise<{id: string}>}) {
  const params = await paramsPromise;
  try {
    const access = await getFinanceAdmin(request, 'finance.packages.write');
    if (!access.user) return apiError(access.status, access.error);
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(params.id)) return badRequest('套餐编号无效。');
    let body: unknown;
    try { body = await request.json(); } catch { return badRequest('套餐数据格式错误。'); }
    return NextResponse.json(await updateManagedPackage(access.user.userId, params.id, body), {headers: privateHeaders});
  } catch (error) {
    return jsonError(error, 'PUT /api/admin/finance/packages/[id]', '套餐修改失败。');
  }
}

export async function DELETE(request: Request, {params: paramsPromise}: {params: Promise<{id:string}>}) {
  const params=await paramsPromise;
  try {
    const access=await getFinanceAdmin(request,'finance.packages.write');
    if(!access.user)return apiError(access.status,access.error);
    if(!/^[A-Za-z0-9_-]{1,100}$/.test(params.id))return badRequest('套餐编号无效。');
    let body:unknown;try{body=await request.json();}catch{return badRequest('删除请求格式错误。');}
    return NextResponse.json(await deleteManagedPackage(access.user.userId,params.id,body),{headers:privateHeaders});
  } catch(error){return jsonError(error,'DELETE /api/admin/finance/packages/[id]','套餐删除失败。');}
}
