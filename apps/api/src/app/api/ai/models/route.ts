import { NextResponse } from 'next/server';
import { logRouteError } from '@rumiai/backend/infrastructure/logging/logger';
import {readAiModelCatalog} from '@rumiai/backend/modules/ai/models/runtime-service';
import {quoteReplyPrice} from '@rumiai/backend/modules/billing/price';
import {readTaskModelPlan} from '@rumiai/backend/modules/ai/models/task-models';
import {getAuthUser} from '@rumiai/backend/infrastructure/auth/auth';
import {ConversationError,readConversationForChat} from '@rumiai/backend/modules/conversations/conversation-service';

export const dynamic = 'force-dynamic';

/** Conversation-scoped requests require ownership; selection and execution share this catalog. */
export async function GET(request:Request) {
  try {
    const conversationId=new URL(request.url).searchParams.get('conversationId');
    let characterId:string|undefined;
    let userId: string | null = null;
    if(conversationId!==null){
      const auth=await getAuthUser(request);if(!auth)return NextResponse.json({error:'请先登录。'},{status:401,headers:{'Cache-Control':'no-store'}});
      if(!conversationId||conversationId.length>100)return NextResponse.json({error:'会话编号无效。'},{status:400,headers:{'Cache-Control':'no-store'}});
      userId = auth.userId;
      characterId=(await readConversationForChat(auth.userId,conversationId)).characterId;
    }
    const catalog = await readAiModelCatalog(characterId);
    if (!userId || !characterId) return NextResponse.json(catalog, {headers: {'Cache-Control': 'no-store'}});
    const plan = await readTaskModelPlan('chat', {characterId});
    const quotes = Object.fromEntries(await Promise.all(catalog.models.map(async modelKey => {const quote = await quoteReplyPrice({userId: userId!, operation: 'CHAT_SEND', modelKey}); return [modelKey, {coins: quote.coins, pricing: quote.pricing}];})));
    return NextResponse.json({...catalog, default: plan?.[0]?.key ?? catalog.default, quotes}, {headers: {'Cache-Control': 'private, no-store'}});
  } catch (error) {
    if(error instanceof ConversationError)return NextResponse.json({error:error.message},{status:error.status,headers:{'Cache-Control':'no-store'}});
    logRouteError('GET /api/ai/models', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
