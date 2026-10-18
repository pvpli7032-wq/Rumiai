import {NextResponse} from 'next/server';
import {logRouteError} from '@/lib/logger';
import {AiCostManagementError} from '@/lib/ai/costs/budget-service';
export const privateHeaders={'Cache-Control':'private, no-store'};
export function costErrorResponse(error:unknown,route:string){if(error instanceof AiCostManagementError)return NextResponse.json({error:error.message},{status:error.status,headers:privateHeaders});logRouteError(route,error);return NextResponse.json({error:'AI 成本管理操作失败，请刷新状态后重试。'},{status:500,headers:privateHeaders});}
export async function readCostJson(request:Request){const size=Number(request.headers.get('content-length')||0);if(size>10000)return{response:NextResponse.json({error:'请求数据过大。'},{status:413,headers:privateHeaders})};try{return{input:await request.json() as unknown};}catch{return{response:NextResponse.json({error:'请求数据格式不正确。'},{status:400,headers:privateHeaders})};}}
