import {NextResponse} from 'next/server';
import {getAuthUser} from '@/lib/auth';
import {readUserMissions} from '@/lib/missions/reward-service';
import {logRouteError} from '@/lib/logger';

export const dynamic='force-dynamic';

export async function GET(request:Request){
  const auth=await getAuthUser(request);
  if(!auth)return NextResponse.json({error:'Unauthorized'},{status:401});
  try{return NextResponse.json(await readUserMissions(auth.userId));}
  catch(error){logRouteError('GET /api/missions',error);return NextResponse.json({error:'Internal server error'},{status:500});}
}
