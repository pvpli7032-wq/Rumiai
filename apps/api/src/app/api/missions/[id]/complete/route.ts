import {NextResponse} from 'next/server';
import {getAuthUser} from '@rumiai/backend/infrastructure/auth/auth';
import {claimMissionReward,MissionClaimError} from '@rumiai/backend/modules/missions/reward-service';
import {logRouteError} from '@rumiai/backend/infrastructure/logging/logger';

export async function POST(request:Request,{params:paramsPromise}:{params:Promise<{id:string}>}){
  const auth=await getAuthUser(request);
  if(!auth)return NextResponse.json({error:'Unauthorized'},{status:401});
  try{
    const {id}=await paramsPromise;
    return NextResponse.json({success:true,...await claimMissionReward(auth.userId,id)});
  }catch(error){
    if(error instanceof MissionClaimError)return NextResponse.json({error:error.message,progress:error.progress,target:error.target},{status:error.status});
    logRouteError('POST /api/missions/[id]/complete',error);return NextResponse.json({error:'Internal server error'},{status:500});
  }
}
