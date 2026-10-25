import {NextResponse} from 'next/server';
import {getAuthUser} from '@rumiai/backend/infrastructure/auth/auth';
import {ConversationError} from '@rumiai/backend/modules/conversations/conversation-service';
import {AiQuotaError} from '@rumiai/backend/modules/ai/ai-usage';
import {ChatSuggestionError,generateChatSuggestions,readChatSuggestionCapability} from '@rumiai/backend/modules/conversations/suggestion-service';
import {logRouteError} from '@rumiai/backend/infrastructure/logging/logger';
export const dynamic='force-dynamic';
function failure(error:unknown){if(error instanceof ConversationError||error instanceof ChatSuggestionError||error instanceof AiQuotaError)return NextResponse.json({error:error.message,code:error instanceof ChatSuggestionError?error.code:'SUGGESTIONS_UNAVAILABLE'},{status:error.status});logRouteError('chat suggestions',error);return NextResponse.json({error:'生成建议失败，请重试。',code:'SUGGESTIONS_FAILED'},{status:502});}
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){const user=await getAuthUser(request);if(!user)return NextResponse.json({error:'请先登录。'},{status:401});try{return NextResponse.json(await readChatSuggestionCapability(user.userId,(await params).id),{headers:{'Cache-Control':'private, no-store'}});}catch(error){return failure(error);}}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){const user=await getAuthUser(request);if(!user)return NextResponse.json({error:'请先登录。'},{status:401});let input:unknown;try{input=await request.json();}catch{return NextResponse.json({error:'请求格式不正确。'},{status:400});}if(!input||typeof input!=='object'||Array.isArray(input))return NextResponse.json({error:'请求格式不正确。'},{status:400});try{return NextResponse.json(await generateChatSuggestions(user.userId,(await params).id,(input as{requestId?:unknown}).requestId,request.signal),{headers:{'Cache-Control':'private, no-store'}});}catch(error){return failure(error);}}
