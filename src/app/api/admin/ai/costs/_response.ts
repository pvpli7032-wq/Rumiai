import {NextResponse} from 'next/server';
import {logRouteError} from '@/lib/logger';
import {privateHeaders, readJsonBody} from '@/lib/http';
import {AiCostManagementError} from '@/lib/ai/costs/budget-service';
export {privateHeaders};
export function costErrorResponse(error:unknown,route:string){if(error instanceof AiCostManagementError)return NextResponse.json({error:error.message},{status:error.status,headers:privateHeaders});logRouteError(route,error);return NextResponse.json({error:'AI 成本管理操作失败，请刷新状态后重试。'},{status:500,headers:privateHeaders});}
export const readCostJson = (request: Request) => readJsonBody(request, {maxBytes: 10_000});
