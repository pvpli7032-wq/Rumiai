import {NextResponse} from 'next/server';
import {db} from '@/lib/db';
import {getAuthUser} from '@/lib/auth';
import {circleSelect,publicCircle,validateCircle,circleRateLimit} from '@/lib/circles';
import {logRouteError} from '@/lib/logger';
import {communityWriteBlock} from '@/lib/community-moderation';
export const dynamic='force-dynamic';

export async function GET(request:Request){
 try{
  const auth=await getAuthUser(request), params=new URL(request.url).searchParams;
  const scope=params.get('scope'),search=params.get('search')?.trim()||'';
  if(scope && !['mine','subscribed'].includes(scope))return NextResponse.json({error:'未知圈子列表类型。'},{status:400});
  if(scope&&!auth)return NextResponse.json({error:'请先登录。'},{status:401});
  if(search.length>100)return NextResponse.json({error:'搜索文字不能超过 100 字符。'},{status:400});
  const rows=await db.circle.findMany({where:{status:'ACTIVE',...(scope==='mine'?{ownerId:auth!.userId}:{}),...(scope==='subscribed'?{members:{some:{userId:auth!.userId}}}:{}),...(search?{OR:[{name:{contains:search}},{description:{contains:search}},{tags:{contains:search}}]}:{})},select:circleSelect(auth?.userId),orderBy:[{createdAt:'desc'},{id:'asc'}],take:100});
  return NextResponse.json(rows.map(publicCircle),{headers:{'Cache-Control':'private, no-store'}});
 }catch(e){logRouteError('GET /api/circles',e);return NextResponse.json({error:'圈子加载失败，请稍后重试。'},{status:500})}
}
export async function POST(request:Request){
 try{
  const auth=await getAuthUser(request);if(!auth)return NextResponse.json({error:'请先登录。'},{status:401});
  const blocked=await communityWriteBlock(auth.userId);if(blocked)return blocked;
  let input;try{input=await request.json()}catch{return NextResponse.json({error:'圈子数据格式不正确。'},{status:400})}
  const validated=await validateCircle(input);if(validated.error)return NextResponse.json({error:validated.error},{status:400});
  const limited=circleRateLimit(auth.userId,'create');if(limited)return limited;
  const circle=await db.circle.create({data:{...validated.data!,ownerId:auth.userId},select:circleSelect(auth.userId)});
  return NextResponse.json(publicCircle(circle),{status:201});
 }catch(e){logRouteError('POST /api/circles',e);return NextResponse.json({error:'创建失败，请稍后重试。'},{status:500})}
}
