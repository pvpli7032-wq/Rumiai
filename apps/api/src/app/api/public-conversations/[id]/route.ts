import {NextResponse} from 'next/server';
import {readPublicConversationShare} from '@rumiai/backend/modules/conversations/share-service';
import {jsonError,privateHeaders} from '@rumiai/backend/infrastructure/http';
export const dynamic='force-dynamic';
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
 try{
  const snapshot=await readPublicConversationShare((await params).id);
  if(!snapshot)return NextResponse.json({error:'分享不存在或已撤销。',code:'NOT_FOUND'},{status:404,headers:privateHeaders});
  return NextResponse.json(snapshot,{headers:privateHeaders});
 }catch(e){return jsonError(e,'public share','无法读取分享。');}
}
