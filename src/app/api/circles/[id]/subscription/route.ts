import {NextResponse} from 'next/server';
import {db} from '@/lib/db';
import {getAuthUser} from '@/lib/auth';
import {circleRateLimit} from '@/lib/circles';
import {logRouteError} from '@/lib/logger';
export const dynamic='force-dynamic';
async function change(request:Request,id:string,subscribe:boolean){
 try{
  const auth=await getAuthUser(request);if(!auth)return NextResponse.json({error:'请先登录。'},{status:401});
  const circle=await db.circle.findFirst({where:{id,status:'ACTIVE'},select:{id:true}});if(!circle)return NextResponse.json({error:'圈子不存在或已隐藏。'},{status:404});
  const limited=circleRateLimit(auth.userId,'membership');if(limited)return limited;
  const result=await db.$transaction(async tx=>{
   if(subscribe)await tx.circleMember.upsert({where:{circleId_userId:{circleId:id,userId:auth.userId}},create:{circleId:id,userId:auth.userId},update:{}});
   else await tx.circleMember.deleteMany({where:{circleId:id,userId:auth.userId}});
   return {subscribed:subscribe,subscriberCount:await tx.circleMember.count({where:{circleId:id}})};
  });
  return NextResponse.json(result,{headers:{'Cache-Control':'private, no-store'}});
 }catch(e){logRouteError('circle subscription',e);return NextResponse.json({error:'订阅操作失败，请重试。'},{status:500})}
}
export async function PUT(request:Request,{params: paramsPromise}:{params:Promise<{id:string}>}){
  const params = await paramsPromise;
return change(request,params.id,true)}
export async function DELETE(request:Request,{params: paramsPromise}:{params:Promise<{id:string}>}){
  const params = await paramsPromise;
return change(request,params.id,false)}
