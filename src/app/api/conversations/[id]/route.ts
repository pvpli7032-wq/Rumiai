import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logRouteError } from '@/lib/logger';
import { getAuthUser } from '@/lib/auth';
import { allowedModels, isAllowedModel } from '@/lib/ai/ai-models';

const MAX_METER = 1_000_000;
const MAX_NOTES = 10_000;

/** Only non-negative and sane. These are not percentages — see the schema comment. */
function meter(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.min(MAX_METER, Math.max(0, Math.round(value)));
}

async function ownedConversation(id: string, userId: string) {
  const conversation = await db.conversation.findUnique({
    where: { id },
    select: { id: true, userId: true },
  });
  if (!conversation) return { error: 'notFound' as const };
  if (conversation.userId !== userId) return { error: 'forbidden' as const };
  return { conversation };
}

/** One chat, with its relationship state, notes and the character it is with. */
export async function GET(request: Request, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;

  try {
    const authUser = await getAuthUser(request);
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const conversation = await db.conversation.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        userId: true,
        title: true,
        relationshipStatus: true,
        romance: true,
        intimacy: true,
        notes: true,
        archivedAt: true,
        relationshipMode: true,
        aiModel: true,
        createdAt: true,
        updatedAt: true,
        character: {
          select: { id: true, name: true, tagline: true, avatarUrl: true, roleTemplate: true, scenario: true, isPublic: true, reviewStatus: true, creatorId: true },
        },
        _count: { select: { messages: true } },
      },
    });
    if (!conversation) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (conversation.userId !== authUser.userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if ((!conversation.character.isPublic || conversation.character.reviewStatus !== 'APPROVED') && conversation.character.creatorId !== authUser.userId) return NextResponse.json({ error: '角色已下架或设为私有，无法继续对话。' }, { status: 403 });
    const { _count, userId: _ignored, ...rest } = conversation;
    // "คุยมา N วัน" on the live panel, counted from when the chat was opened.
    const daysChatting = Math.max(
      0,
      Math.floor((Date.now() - rest.createdAt.getTime()) / (24 * 60 * 60 * 1000))
    );

    return NextResponse.json({
      conversation: { ...rest, messageCount: _count.messages, daysChatting },
    });
  } catch (error) {
    logRouteError('GET /api/conversations/[id]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** Update the chat's own state: title, notes, relationship meters, archive. */
export async function PATCH(request: Request, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;

  try {
    const authUser = await getAuthUser(request);
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const owned = await ownedConversation(params.id, authUser.userId);
    if (owned.error === 'notFound') return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (owned.error === 'forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const body = await request.json();
    const notes = typeof body.notes === 'string' ? body.notes : undefined;
    if (notes !== undefined && notes.length > MAX_NOTES) {
      return NextResponse.json({ error: `Notes must be ${MAX_NOTES} characters or fewer` }, { status: 400 });
    }
    const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : undefined;
    const relationshipStatus =
      typeof body.relationshipStatus === 'string' ? body.relationshipStatus : undefined;
    const romance = meter(body.romance);
    const intimacy = meter(body.intimacy);
    const archived = typeof body.archived === 'boolean' ? body.archived : undefined;
    const relationshipMode =
      typeof (body.relationshipMode ?? body.relationship_mode) === 'boolean'
        ? (body.relationshipMode ?? body.relationship_mode)
        : undefined;

    // Picking a model has to be limited to the configured chain: the provider quota is
    // shared platform-wide, so an arbitrary model name would let one reader spend
    // everyone's budget wherever they liked. null clears the override.
    let aiModel: string | null | undefined;
    const requestedModel = body.aiModel ?? body.ai_model;
    if (requestedModel === null) {
      aiModel = null;
    } else if (requestedModel !== undefined) {
      if (!isAllowedModel(requestedModel)) {
        return NextResponse.json(
          { error: `aiModel must be one of ${allowedModels().join(', ')}` },
          { status: 400 }
        );
      }
      aiModel = requestedModel;
    }

    const conversation = await db.conversation.update({
      where: { id: params.id },
      data: {
        ...(title !== undefined && { title }),
        ...(notes !== undefined && { notes }),
        ...(relationshipStatus !== undefined && { relationshipStatus }),
        ...(romance !== undefined && { romance }),
        ...(intimacy !== undefined && { intimacy }),
        ...(archived !== undefined && { archivedAt: archived ? new Date() : null }),
        ...(relationshipMode !== undefined && { relationshipMode }),
        ...(aiModel !== undefined && { aiModel }),
      },
      select: {
        id: true,
        title: true,
        relationshipStatus: true,
        romance: true,
        intimacy: true,
        notes: true,
        archivedAt: true,
        relationshipMode: true,
        aiModel: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({ conversation });
  } catch (error) {
    logRouteError('PATCH /api/conversations/[id]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** Remove a chat and its messages. */
export async function DELETE(request: Request, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;

  try {
    const authUser = await getAuthUser(request);
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const owned = await ownedConversation(params.id, authUser.userId);
    if (owned.error === 'notFound') return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (owned.error === 'forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    await db.conversation.delete({ where: { id: params.id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    logRouteError('DELETE /api/conversations/[id]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
