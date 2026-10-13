import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getModerator } from '@/lib/moderator';
import { logRouteError } from '@/lib/logger';
export async function GET(request:Request){
 if(!await getModerator(request, 'moderation.read'))return NextResponse.json({error:'此页面仅限审核人员访问。'},{status:403});
 try{
 const characters=await db.character.findMany({where:{publicationRequested:true,reviewStatus:{in:['PENDING','APPROVED']}},orderBy:[{reviewStatus:'desc'},{updatedAt:'desc'}],take:100,include:{creator:{select:{username:true}}}});
 const counts=await db.report.groupBy({by:['targetId'],where:{targetType:'CHARACTER',status:{in:['OPEN','REVIEWING']},targetId:{in:characters.map(c=>c.id)}},_count:true});
 return NextResponse.json(characters.map(c=>({...c,openReportCount:counts.find(row=>row.targetId===c.id)?._count||0})));
 }catch(e){logRouteError('GET moderation characters',e);return NextResponse.json({error:'审核列表加载失败。'},{status:500});}
}
