import {NextResponse} from 'next/server';
import {getAuthUser} from '@rumiai/backend/infrastructure/auth/auth';
import {claimDailyCheckin,CheckinError,readCheckinStatus} from '@rumiai/backend/modules/checkins/service';
import {logRouteError} from '@rumiai/backend/infrastructure/logging/logger';

export const dynamic='force-dynamic';

export async function GET(request:Request){
  const auth=await getAuthUser(request);
  if(!auth)return NextResponse.json({error:'Unauthorized'},{status:401});
  try{return NextResponse.json(await readCheckinStatus(auth.userId));}
  catch(error){
    if(error instanceof CheckinError)return NextResponse.json({error:error.message},{status:error.status});
    logRouteError('GET /api/checkin',error);return NextResponse.json({error:'Internal server error'},{status:500});
  }
}

export async function POST(request:Request){
  const auth=await getAuthUser(request);
  if(!auth)return NextResponse.json({error:'Unauthorized'},{status:401});
  try{return NextResponse.json(await claimDailyCheckin(auth.userId));}
  catch(error){
    if(error instanceof CheckinError)return NextResponse.json({error:error.message,checkedInToday:error.status===409},{status:error.status});
    logRouteError('POST /api/checkin',error);return NextResponse.json({error:'Internal server error'},{status:500});
  }
}
