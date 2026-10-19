import {NextResponse} from 'next/server';
import {logRouteError} from '@/lib/logger';
import {privateHeaders, readJsonBody} from '@/lib/http';
import {AiProviderError} from '@/lib/ai/providers/management-service';

export {privateHeaders};
export function providerErrorResponse(error:unknown,route:string){
  if(error instanceof AiProviderError)return NextResponse.json({error:error.message},{status:error.status,headers:privateHeaders});
  logRouteError(route,error);
  return NextResponse.json({error:'AI 供应商管理操作失败，请核对状态后重试。'},{status:500,headers:privateHeaders});
}
export const readProviderJson = (request: Request) => readJsonBody(request, {maxBytes: 12_000});
