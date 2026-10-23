import {NextResponse} from 'next/server';
import {logRouteError} from '@rumiai/backend/infrastructure/logging/logger';
import {privateHeaders, readJsonBody} from '@rumiai/backend/infrastructure/http';
import {AiModelError} from '@rumiai/backend/modules/ai/models/management-service';

export {privateHeaders};
export function modelErrorResponse(error:unknown,route:string){if(error instanceof AiModelError)return NextResponse.json({error:error.message},{status:error.status,headers:privateHeaders});logRouteError(route,error);return NextResponse.json({error:'AI 模型管理操作失败，请核对状态后重试。'},{status:500,headers:privateHeaders});}
export const readModelJson = (request: Request) => readJsonBody(request, {maxBytes: 12_000});
