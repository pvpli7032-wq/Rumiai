import {NextResponse} from 'next/server';
import {getAdminRequestUser} from '@rumiai/backend/modules/admin-auth/request';
import {deleteAiModel,saveAiModel} from '@rumiai/backend/modules/ai/models/management-service';
import {modelErrorResponse,privateHeaders,readModelJson} from '../_response';

export async function PATCH(request:Request,{params:paramsPromise}:{params:Promise<{id:string}>}){try{const auth=await getAdminRequestUser(request);if(!auth)return NextResponse.json({error:'请先登录。'},{status:401,headers:privateHeaders});const parsed=await readModelJson(request);if('response'in parsed)return parsed.response;const {id}=await paramsPromise;return NextResponse.json(await saveAiModel(auth.userId,{...(parsed.input as object),id}),{headers:privateHeaders});}catch(error){return modelErrorResponse(error,'PATCH /api/admin/ai/models/[id]');}}
export async function DELETE(request:Request,{params:paramsPromise}:{params:Promise<{id:string}>}){try{const auth=await getAdminRequestUser(request);if(!auth)return NextResponse.json({error:'请先登录。'},{status:401,headers:privateHeaders});const parsed=await readModelJson(request);if('response'in parsed)return parsed.response;const {id}=await paramsPromise;return NextResponse.json(await deleteAiModel(auth.userId,id,parsed.input),{headers:privateHeaders});}catch(error){return modelErrorResponse(error,'DELETE /api/admin/ai/models/[id]');}}
