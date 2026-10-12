import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logRouteError } from '@/lib/logger';
import { getAuthUser } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { formatUser } from '@/lib/user-identity';

export const dynamic = 'force-dynamic';

const MAX_BODY = 2_000;
const PAGE_SIZE = 30;
/** Posting is cheap for us and noisy for everyone else, so it gets its own ceiling. */
const COMMENT_LIMIT = Number(process.env.COMMENT_RATE_LIMIT) || 20;
const COMMENT_WINDOW_MS = Number(process.env.COMMENT_RATE_WINDOW_MS) || 600_000;

const AUTHOR_SELECT = { id: true, username: true, displayName: true, avatarUrl: true } as const;

async function readableCharacter(id: string, userId?: string) {
  const character = await db.character.findUnique({
    where: { id },
    select: { id: true, isPublic: true, reviewStatus: true, creatorId: true },
  });
  if (!character) return { error: 'notFound' as const };
  if ((!character.isPublic || character.reviewStatus !== 'APPROVED') && character.creatorId !== userId) return { error: 'forbidden' as const };
  return { character };
}

/**
 * A character's comments, newest first, with one level of replies attached to each.
 *
 * Hidden comments are filtered out for everyone: the row survives so replies keep their
 * parent and a reporter can still see what they filed against, but it is not served.
 */
export async function GET(request: Request, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;

  try {
    const authUser = await getAuthUser(request);

    const readable = await readableCharacter(params.id, authUser?.userId);
    if (readable.error === 'notFound') {
      return NextResponse.json({ error: 'Character not found' }, { status: 404 });
    }
    if (readable.error === 'forbidden') {
      return NextResponse.json({ error: 'Private character access forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const take = Math.min(PAGE_SIZE, Math.max(1, Number(searchParams.get('limit')) || PAGE_SIZE));
    const cursor = searchParams.get('cursor');

    const roots = await db.comment.findMany({
      where: { characterId: params.id, parentId: null, hiddenAt: null },
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        body: true,
        likeCount: true,
        createdAt: true,
        updatedAt: true,
        author: { select: AUTHOR_SELECT },
        replies: {
          where: { hiddenAt: null },
          orderBy: { createdAt: 'asc' },
          take: 10,
          select: {
            id: true,
            body: true,
            likeCount: true,
            createdAt: true,
            updatedAt: true,
            author: { select: AUTHOR_SELECT },
          },
        },
        _count: { select: { replies: true } },
      },
    });

    const hasMore = roots.length > take;
    const page = hasMore ? roots.slice(0, take) : roots;

    // Which of these the reader has liked, so the hearts render in the right state.
    // One query for the whole page rather than one per comment.
    const ids = page.flatMap((c) => [c.id, ...c.replies.map((r) => r.id)]);
    const liked = authUser && ids.length
      ? await db.commentLike.findMany({
          where: { userId: authUser.userId, commentId: { in: ids } },
          select: { commentId: true },
        })
      : [];
    const likedSet = new Set(liked.map((l) => l.commentId));

    const shape = (c: any) => ({
      id: c.id,
      body: c.body,
      likeCount: c.likeCount,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      author: formatUser(c.author),
      isMine: c.author.id === authUser?.userId,
      hasLiked: likedSet.has(c.id),
    });

    return NextResponse.json({
      comments: page.map((c) => ({
        ...shape(c),
        replyCount: c._count.replies,
        replies: c.replies.map(shape),
      })),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    });
  } catch (error) {
    logRouteError('GET /api/characters/[id]/comments', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: Request, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;

  try {
    const authUser = await getAuthUser(request);
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const readable = await readableCharacter(params.id, authUser.userId);
    if (readable.error === 'notFound') {
      return NextResponse.json({ error: 'Character not found' }, { status: 404 });
    }
    if (readable.error === 'forbidden') {
      return NextResponse.json({ error: 'Private character access forbidden' }, { status: 403 });
    }

    const requestBody = await request.json();
    const body = typeof requestBody.body === 'string' ? requestBody.body.trim() : '';
    if (!body) return NextResponse.json({ error: 'body is required' }, { status: 400 });
    if (body.length > MAX_BODY) {
      return NextResponse.json({ error: `body must be ${MAX_BODY} characters or fewer` }, { status: 400 });
    }

    const rawParent = requestBody.parentId ?? requestBody.parent_id;
    let parentId: string | null = null;
    if (typeof rawParent === 'string' && rawParent) {
      const parent = await db.comment.findUnique({
        where: { id: rawParent },
        select: { id: true, characterId: true, parentId: true },
      });
      if (!parent || parent.characterId !== params.id) {
        return NextResponse.json({ error: 'Parent comment not found' }, { status: 404 });
      }
      // One level only. Replying to a reply attaches to the same root, so a thread cannot
      // nest without bound — deep nesting needs its own pagination and moderation story.
      parentId = parent.parentId ?? parent.id;
    }

    const limit = checkRateLimit(`comment:${authUser.userId}`, COMMENT_LIMIT, COMMENT_WINDOW_MS);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: 'คอมเมนต์ถี่เกินไป กรุณารอสักครู่' },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } }
      );
    }

    const comment = await db.comment.create({
      data: { characterId: params.id, authorId: authUser.userId, parentId, body },
      select: {
        id: true,
        body: true,
        parentId: true,
        likeCount: true,
        createdAt: true,
        updatedAt: true,
        author: { select: AUTHOR_SELECT },
      },
    });

    return NextResponse.json(
      {
        comment: {
          ...comment,
          author: formatUser(comment.author),
          isMine: true,
          hasLiked: false,
          replies: [],
          replyCount: 0,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    logRouteError('POST /api/characters/[id]/comments', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
