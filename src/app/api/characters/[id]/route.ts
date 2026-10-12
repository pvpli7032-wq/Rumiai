import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logRouteError } from '@/lib/logger';
import { validateCharacter } from '@/lib/characters/validation';
import { getAuthUser } from '@/lib/auth';

export async function GET(request: Request, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;

  try {
    const authUser = await getAuthUser(request);
    const character = await db.character.findUnique({
      where: { id: params.id },
      include: {
        creator: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
        // Everything the detail view shows: the picture gallery it pages through, the
        // per-emotion portraits, and the secondary cast.
        images: { orderBy: { sortOrder: 'asc' }, select: { id: true, url: true, sortOrder: true } },
        emojis: { orderBy: { sortOrder: 'asc' }, select: { id: true, emotion: true, url: true } },
        supportCast: {
          orderBy: { sortOrder: 'asc' },
          select: { id: true, name: true, avatarUrl: true, description: true },
        },
      },
    });
    if (!character) return NextResponse.json({ error: 'Character not found' }, { status: 404 });

    if ((!character.isPublic || character.reviewStatus !== 'APPROVED') && character.creatorId !== authUser?.userId) {
      return NextResponse.json({ error: 'Private character access forbidden' }, { status: 403 });
    }

    // Whether *this* viewer has liked or bookmarked it, so the buttons render in the
    // right state. Anonymous viewers get false rather than a query.
    const [liked, bookmarked] = authUser
      ? await Promise.all([
          db.characterLike.findUnique({
            where: { userId_characterId: { userId: authUser.userId, characterId: character.id } },
            select: { id: true },
          }),
          db.characterBookmark.findUnique({
            where: { userId_characterId: { userId: authUser.userId, characterId: character.id } },
            select: { id: true },
          }),
        ])
      : [null, null];

    const payload = {
      ...character,
      viewer: { hasLiked: Boolean(liked), hasBookmarked: Boolean(bookmarked) },
    };

    return NextResponse.json({ character: payload, ...payload });
  } catch (error) {
    logRouteError('GET /api/characters/[id]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(request: Request, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;

  try {
    const authUser = await getAuthUser(request);
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const character = await db.character.findUnique({ where: { id: params.id } });
    if (!character) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (character.creatorId !== authUser.userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    let body: unknown;
    try { body = await request.json(); } catch { return NextResponse.json({ error: '角色数据格式不正确。' }, { status: 400 }); }
    const validated = validateCharacter(body, false);
    if (validated.error) return NextResponse.json({ error: validated.error }, { status: 400 });
    const { isPublic: requested, ...content } = validated.data;
    const publishing = requested ?? character.publicationRequested;
    const copyright = 'copyrightStatement' in content ? content.copyrightStatement : character.copyrightStatement;
    if (publishing && !copyright?.trim()) return NextResponse.json({ error: '申请公开前请填写角色及素材版权声明。' }, { status: 400 });
    const changed = Object.entries(content).some(([key,value]) => value !== (character as any)[key]);
    const resubmit = publishing && (changed || requested === true && !character.isPublic);
    const updated = await db.character.update({ where: { id: params.id }, data: { ...content,
      ...(requested === false ? {isPublic:false,publicationRequested:false,reviewStatus:'DRAFT',reviewReason:null,reviewedAt:null,reviewedBy:null} : resubmit ? {isPublic:false,publicationRequested:true,reviewStatus:'PENDING',reviewReason:null,reviewedAt:null,reviewedBy:null} : {}),
    } });
    return NextResponse.json({ character: updated, ...updated });
  } catch (error) {
    logRouteError('PUT /api/characters/[id]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;

  try {
    const authUser = await getAuthUser(request);
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const character = await db.character.findUnique({ where: { id: params.id } });
    if (!character) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (character.creatorId !== authUser.userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    await db.character.delete({ where: { id: params.id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    logRouteError('DELETE /api/characters/[id]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
