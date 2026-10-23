import { NextResponse } from 'next/server';
import { logRouteError } from '@rumiai/backend/infrastructure/logging/logger';
import { getAuthUser } from '@rumiai/backend/infrastructure/auth/auth';
import { likeCharacterComment, unlikeCharacterComment } from '@rumiai/backend/modules/characters/comment-service';
import { commentError } from '@api/app/api/comments/_response';

export async function POST(request: Request, {params}: {params: Promise<{commentId: string}>}) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({error: 'Unauthorized'}, {status: 401});
    return NextResponse.json(await likeCharacterComment(auth.userId, (await params).commentId));
  } catch (error) {
    const response = commentError(error);
    if (response) return response;
    logRouteError('POST /api/comments/[commentId]/like', error);
    return NextResponse.json({error: 'Internal server error'}, {status: 500});
  }
}

export async function DELETE(request: Request, {params}: {params: Promise<{commentId: string}>}) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({error: 'Unauthorized'}, {status: 401});
    return NextResponse.json(await unlikeCharacterComment(auth.userId, (await params).commentId));
  } catch (error) {
    const response = commentError(error);
    if (response) return response;
    logRouteError('DELETE /api/comments/[commentId]/like', error);
    return NextResponse.json({error: 'Internal server error'}, {status: 500});
  }
}
