import {NextResponse} from 'next/server';
import {getAuthUser} from '@rumiai/backend/infrastructure/auth/auth';
import {listCharacterCommentReplies} from '@rumiai/backend/modules/characters/comment-service';
import {commentError} from '../../_response';
export async function GET(request:Request,{params}:{params:Promise<{commentId:string}>}){try{const user=await getAuthUser(request);return NextResponse.json(await listCharacterCommentReplies((await params).commentId,user?.userId,new URL(request.url).searchParams.get('cursor')),{headers:{'Cache-Control':'private,no-store'}});}catch(e){return commentError(e)??NextResponse.json({error:'回复加载失败。'},{status:500});}}
