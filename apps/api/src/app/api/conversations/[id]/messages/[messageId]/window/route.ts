import {NextResponse} from 'next/server';
import {requireUser,unauthorized,jsonError,privateHeaders} from '@rumiai/backend/infrastructure/http';
import {readMessageWindow} from '@rumiai/backend/modules/conversations/search/window';
export async function GET(request:Request,{params}:{params:Promise<{id:string;messageId:string}>}){const user=await requireUser(request);if(!user)return unauthorized();try{const p=await params;return NextResponse.json(await readMessageWindow(user.userId,p.id,p.messageId),{headers:privateHeaders});}catch(error){return jsonError(error,'GET message window','定位消息失败。');}}
