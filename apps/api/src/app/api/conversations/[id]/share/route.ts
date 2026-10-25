import {NextResponse} from 'next/server';
import {jsonError,requireUser,unauthorized,privateHeaders,apiError} from '@rumiai/backend/infrastructure/http';
import {previewConversationShare,createConversationShare,revokeConversationShare} from '@rumiai/backend/modules/conversations/share-service';
export const dynamic='force-dynamic';
type Context={params:Promise<{id:string}>};
export async function GET(request:Request,{params}:Context){
 const user=await requireUser(request);if(!user)return unauthorized();
 try{return NextResponse.json(await previewConversationShare(user.userId,(await params).id),{headers:privateHeaders});}
 catch(e){return jsonError(e,'share preview','无法读取分享预览。');}
}
export async function POST(request:Request,{params}:Context){
 const user=await requireUser(request);if(!user)return unauthorized();
 let body:unknown;try{body=await request.json();}catch{return apiError(400,'分享数据格式不正确。');}
 try{return NextResponse.json(await createConversationShare(user.userId,(await params).id,body),{headers:privateHeaders});}
 catch(e){return jsonError(e,'share create','无法创建分享。');}
}
export async function DELETE(request:Request,{params}:Context){
 const user=await requireUser(request);if(!user)return unauthorized();
 let body:{shareId?:unknown};try{body=await request.json();}catch{return apiError(400,'分享数据格式不正确。');}
 try{return NextResponse.json(await revokeConversationShare(user.userId,(await params).id,body?.shareId),{headers:privateHeaders});}
 catch(e){return jsonError(e,'share revoke','无法撤销分享。');}
}
