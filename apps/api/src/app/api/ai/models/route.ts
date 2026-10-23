import { NextResponse } from 'next/server';
import { logRouteError } from '@rumiai/backend/infrastructure/logging/logger';
import {readAiModelCatalog} from '@rumiai/backend/modules/ai/models/runtime-service';
import {getAuthUser} from '@rumiai/backend/infrastructure/auth/auth';
import {ConversationError,readConversationForChat} from '@rumiai/backend/modules/conversations/conversation-service';

export const dynamic = 'force-dynamic';

/** Conversation-scoped requests require ownership; selection and execution share this catalog. */
export async function GET(request:Request) {
  try {
    const conversationId=new URL(request.url).searchParams.get('conversationId');
    let characterId:string|undefined;
    if(conversationId!==null){
      const auth=await getAuthUser(request);if(!auth)return NextResponse.json({error:'请先登录。'},{status:401,headers:{'Cache-Control':'no-store'}});
      if(!conversationId||conversationId.length>100)return NextResponse.json({error:'会话编号无效。'},{status:400,headers:{'Cache-Control':'no-store'}});
      characterId=(await readConversationForChat(auth.userId,conversationId)).characterId;
    }
    return NextResponse.json(await readAiModelCatalog(characterId),{headers:{'Cache-Control':'no-store'}});
  } catch (error) {
    if(error instanceof ConversationError)return NextResponse.json({error:error.message},{status:error.status,headers:{'Cache-Control':'no-store'}});
    logRouteError('GET /api/ai/models', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
