import { NextResponse } from 'next/server';
import { logRouteError } from '@/lib/logger';
import { getAuthUser } from '@/lib/auth';
import { createCharacterComment, listCharacterComments } from '@/lib/characters/comment-service';
import { commentError } from '@/app/api/comments/_response';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, {params}: {params: Promise<{id: string}>}) {
  try {
    const auth = await getAuthUser(request);
    const {id} = await params;
    const {searchParams} = new URL(request.url);
    const result = await listCharacterComments(id, auth?.userId, {
      limit: Number(searchParams.get('limit')) || undefined,
      cursor: searchParams.get('cursor'),
    });
    return NextResponse.json(result);
  } catch (error) {
    const response = commentError(error);
    if (response) return response;
    logRouteError('GET /api/characters/[id]/comments', error);
    return NextResponse.json({error: 'Internal server error'}, {status: 500});
  }
}

export async function POST(request: Request, {params}: {params: Promise<{id: string}>}) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({error: 'Unauthorized'}, {status: 401});
    const {id} = await params;
    let body: unknown;
    try { body = await request.json(); }
    catch { return NextResponse.json({error: '评论数据格式不正确。'}, {status: 400}); }
    return NextResponse.json(await createCharacterComment(auth.userId, id, body), {status: 201});
  } catch (error) {
    const response = commentError(error);
    if (response) return response;
    logRouteError('POST /api/characters/[id]/comments', error);
    return NextResponse.json({error: 'Internal server error'}, {status: 500});
  }
}
