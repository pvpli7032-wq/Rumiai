import {NextResponse} from 'next/server';
import {getAuthUser} from '@/lib/auth';
import {GiftSendError,sendCatalogGift} from '@/lib/gifts/send-service';
import {logRouteError} from '@/lib/logger';

export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
  const auth=await getAuthUser(request);
  if(!auth)return NextResponse.json({error:'请先登录。'},{status:401});
  try{
    const body=await request.json(),{id}=await params;
    return NextResponse.json({success:true,...await sendCatalogGift(auth.userId,id,body)},{status:201});
  }catch(error){
    if(error instanceof GiftSendError)return NextResponse.json({error:error.message},{status:error.status});
    logRouteError('POST /api/characters/[id]/gift',error);return NextResponse.json({error:'赠送礼物失败。'},{status:500});
  }
}
