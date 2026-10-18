import { NextResponse } from 'next/server';
import { logRouteError } from '@/lib/logger';
import { getAuthUser } from '@/lib/auth';
import {GiftSendError,sendCatalogGift} from '@/lib/gifts/send-service';
import { listGiftLeaderboard } from '@/lib/gifts/read-service';

export async function GET(request: Request) {
  try {
    return NextResponse.json(await listGiftLeaderboard());
  } catch (error) {
    logRouteError('GET /api/leaderboard/gifts', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const authUser = await getAuthUser(request);
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body=await request.json();
    const result=await sendCatalogGift(authUser.userId,body.characterId,body);
    return NextResponse.json({success:true,...result});
  } catch (error) {
    if(error instanceof GiftSendError)return NextResponse.json({error:error.message},{status:error.status});
    logRouteError('POST /api/leaderboard/gifts', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
