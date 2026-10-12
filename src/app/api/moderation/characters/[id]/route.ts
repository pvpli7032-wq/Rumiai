import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getModerator } from '@/lib/moderator';
import { logRouteError } from '@/lib/logger';
export async function PUT(request:Request,{params: paramsPromise}:{params:Promise<{id:string}>}){
  const params = await paramsPromise;

 const moderator=await getModerator(request);
 if(!moderator)return NextResponse.json({error:'此操作仅限审核人员。'},{status:403});
 let body:any;try{body=await request.json()}catch{return NextResponse.json({error:'审核数据格式不正确。'},{status:400})}
 if(!body||!['APPROVED','REJECTED'].includes(body.status)||typeof body.updatedAt!=='string'||!Number.isFinite(Date.parse(body.updatedAt))||typeof body.reason!=='string'||body.reason.length>1000||body.status==='REJECTED'&&!body.reason.trim())return NextResponse.json({error:'请选择审核结果；退回时填写原因，最多 1000 字。'},{status:400});
 try{
 const character=await db.character.findUnique({where:{id:params.id}});
 if(!character)return NextResponse.json({error:'角色不存在。'},{status:404});
 if(body.status==='APPROVED'&&!character.copyrightStatement?.trim())return NextResponse.json({error:'缺少版权声明，请退回补充。'},{status:400});
 const result=await db.character.updateMany({where:{id:params.id,updatedAt:new Date(body.updatedAt),publicationRequested:true,reviewStatus:{in:['PENDING','APPROVED']}},data:{isPublic:body.status==='APPROVED',reviewStatus:body.status,reviewReason:body.reason.trim()||null,reviewedBy:moderator.userId,reviewedAt:new Date()}});
 if(!result.count)return NextResponse.json({error:'角色已修改或撤回，请刷新后重新审核。'},{status:409});
 return NextResponse.json({success:true});
 }catch(e){logRouteError('PUT moderation character',e);return NextResponse.json({error:'审核保存失败。'},{status:500});}
}
