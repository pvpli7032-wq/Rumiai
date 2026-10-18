import {NextResponse} from 'next/server';
import {logRouteError} from '@/lib/logger';
import {AiModelError} from '@/lib/ai/models/management-service';

export const privateHeaders={'Cache-Control':'private, no-store'};
export function modelErrorResponse(error:unknown,route:string){if(error instanceof AiModelError)return NextResponse.json({error:error.message},{status:error.status,headers:privateHeaders});logRouteError(route,error);return NextResponse.json({error:'AI 模型管理操作失败，请核对状态后重试。'},{status:500,headers:privateHeaders});}
export async function readModelJson(request:Request){const length=Number(request.headers.get('content-length')||0);if(length>12000)return{response:NextResponse.json({error:'请求数据过大。'},{status:413,headers:privateHeaders})};try{return{input:await request.json() as unknown};}catch{return{response:NextResponse.json({error:'请求数据格式不正确。'},{status:400,headers:privateHeaders})};}}
