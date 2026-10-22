import { NextResponse } from 'next/server';
import { logRouteError } from '@/lib/logger';
import { getAuthUser } from '@/lib/auth';
import { likeCharacterComment, unlikeCharacterComment } from '@/lib/characters/comment-service';
import { commentError } from '@/app/api/comments/_response';

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
