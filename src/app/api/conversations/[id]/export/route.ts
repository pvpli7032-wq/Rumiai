import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { logRouteError } from '@/lib/logger';
export const dynamic='force-dynamic';
/** Export owned history even if the role was withdrawn. Never export its current private persona. */
export async function GET(request:Request,{params: paramsPromise}:{params:Promise<{id:string}>}){
  const params = await paramsPromise;

 try{
  const user=await getAuthUser(request);if(!user)return NextResponse.json({error:'请先登录。'},{status:401});
  const format=new URL(request.url).searchParams.get('format')||'json';
  if(!['json','txt'].includes(format))return NextResponse.json({error:'导出格式仅支持 JSON 或文本。'},{status:400});
  const owner=await db.conversation.findUnique({where:{id:params.id},select:{userId:true}});
  if(!owner)return NextResponse.json({error:'对话不存在。'},{status:404});
  if(owner.userId!==user.userId)return NextResponse.json({error:'只能导出自己的对话。'},{status:403});
  const conversation=await db.conversation.findUnique({where:{id:params.id},select:{id:true,title:true,notes:true,createdAt:true,updatedAt:true,archivedAt:true,character:{select:{id:true,name:true,isPublic:true,reviewStatus:true,creatorId:true}},messages:{orderBy:[{createdAt:'asc'},{id:'asc'}],select:{id:true,role:true,content:true,imageUrl:true,createdAt:true}}}});
  if(!conversation)return NextResponse.json({error:'对话不存在。'},{status:404});
  const {messages,character,...ownedMetadata}=conversation;
  const visible=character.creatorId===user.userId||character.isPublic&&character.reviewStatus==='APPROVED';
  const metadata={...ownedMetadata,character:{id:character.id,name:visible?character.name:'暂不可用的角色'}};
  const exportedAt=new Date().toISOString();
  const labels:Record<string,string>={USER:'我',ASSISTANT:'AI 角色',SYSTEM:'系统'};
  const text=format==='json'?JSON.stringify({exportedAt,conversation:metadata,messages},null,2):'\ufeff'+[
    '星伴聊天记录',`角色：${metadata.character.name}`,`对话：${metadata.title||metadata.id}`,`导出时间：${exportedAt}`,
    ...(metadata.notes?[`我的笔记：${metadata.notes}`]:[]),'',
    ...messages.map(m=>`[${m.createdAt.toISOString()}] ${labels[m.role]||m.role}\n${m.content}${m.imageUrl?'\n图片：'+m.imageUrl:''}\n`),
  ].join('\n');
  return new Response(text,{headers:{'Content-Type':format==='json'?'application/json; charset=utf-8':'text/plain; charset=utf-8','Content-Disposition':`attachment; filename="xingban-chat-${metadata.id}.${format}"`,'Cache-Control':'private, no-store'}});
 }catch(error){logRouteError('GET conversation export',error);return NextResponse.json({error:'导出失败，请重试。'},{status:500});}
}
