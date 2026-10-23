import { NextResponse } from 'next/server';
import { logRouteError } from '@rumiai/backend/infrastructure/logging/logger';
import { getAuthUser } from '@rumiai/backend/infrastructure/auth/auth';
import { deleteCharacterComment, updateCharacterComment } from '@rumiai/backend/modules/characters/comment-service';
import { commentError } from '@api/app/api/comments/_response';

export async function PATCH(request: Request, {params}: {params: Promise<{commentId: string}>}) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({error: 'Unauthorized'}, {status: 401});
    let body: unknown;
    try { body = await request.json(); }
    catch { return NextResponse.json({error: '评论数据格式不正确。'}, {status: 400}); }
    const comment = await updateCharacterComment(auth.userId, (await params).commentId, body);
    return NextResponse.json({comment});
  } catch (error) {
    const response = commentError(error);
    if (response) return response;
    logRouteError('PATCH /api/comments/[commentId]', error);
    return NextResponse.json({error: 'Internal server error'}, {status: 500});
  }
}

export async function DELETE(request: Request, {params}: {params: Promise<{commentId: string}>}) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({error: 'Unauthorized'}, {status: 401});
    const result = await deleteCharacterComment(auth.userId, (await params).commentId);
    return NextResponse.json(result);
  } catch (error) {
    const response = commentError(error);
    if (response) return response;
    logRouteError('DELETE /api/comments/[commentId]', error);
    return NextResponse.json({error: 'Internal server error'}, {status: 500});
  }
}
