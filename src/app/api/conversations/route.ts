import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logRouteError } from '@/lib/logger';
import { getAuthUser } from '@/lib/auth';

const CONVERSATION_SELECT = {
  id: true,
  title: true,
  characterId: true,
  relationshipStatus: true,
  romance: true,
  intimacy: true,
  notes: true,
  archivedAt: true,
  relationshipMode: true,
  aiModel: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * List the caller's conversations for the sidebar. Archived chats live behind their own
 * button on the live site, so they are excluded unless asked for.
 */
export async function GET(request: Request) {
  try {
    const authUser = await getAuthUser(request);
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const archived = searchParams.get('archived') === 'true';
    const characterId = searchParams.get('characterId');

    const conversations = await db.conversation.findMany({
      where: {
        userId: authUser.userId,
        ...(characterId ? { characterId } : {}),
        ...(archived ? { archivedAt: { not: null } } : { archivedAt: null }),
      },
      orderBy: { updatedAt: 'desc' },
      take: 200,
      select: {
        ...CONVERSATION_SELECT,
        character: { select: { id: true, name: true, avatarUrl: true, isPublic:true, reviewStatus:true, creatorId:true } },
        _count: { select: { messages: true } },
      },
    });

    return NextResponse.json(
      conversations.map(({ _count, character, ...conversation }) => {
        const visible=character.creatorId===authUser.userId||character.isPublic&&character.reviewStatus==='APPROVED';
        return {...conversation,messageCount:_count.messages,character:{id:character.id,name:visible?character.name:'暂不可用的角色',avatarUrl:visible?character.avatarUrl:null}};
      })
    );
  } catch (error) {
    logRouteError('GET /api/conversations', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const authUser = await getAuthUser(request);
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const characterId = body.characterId || body.character_id;
    if (!characterId) return NextResponse.json({ error: 'characterId is required' }, { status: 400 });
    // "แชทใหม่" starts a fresh conversation rather than reopening the last one. Without
    // this the app could only ever hold one chat per character, while the live site
    // lists several and offers "แชทอื่น" to move between them.
    const startNew = (body.newChat ?? body.new_chat) === true;

    const character = await db.character.findUnique({
      where: { id: characterId },
      select: {
        id: true,
        name: true,
        isPublic: true,
        reviewStatus: true,
        creatorId: true,
        relationshipStatus: true,
        initialRomance: true,
        initialIntimacy: true,
      },
    });
    if (!character) return NextResponse.json({ error: 'Character not found' }, { status: 404 });
    // GET /api/characters/:id already refuses private characters to non-owners.
    // Without the same check here, anyone holding the id could open a chat and
    // read the creator's private personality back through the AI's replies.
    if ((!character.isPublic || character.reviewStatus !== 'APPROVED') && character.creatorId !== authUser.userId) {
      return NextResponse.json({ error: 'Private character access forbidden' }, { status: 403 });
    }

    const existing = startNew
      ? null
      : await db.conversation.findFirst({
          where: { userId: authUser.userId, characterId, archivedAt: null },
          orderBy: { updatedAt: 'desc' },
          select: CONVERSATION_SELECT,
        });

    if (existing) return NextResponse.json({ conversation: existing }, { status: 201 });

    const conversation = await db.conversation.create({
      data: {
        userId: authUser.userId,
        characterId,
        title: `แชทกับ ${character.name}`,
        // Seed from the character's starting values; the conversation carries its own
        // state from here on.
        relationshipStatus: character.relationshipStatus,
        romance: character.initialRomance,
        intimacy: character.initialIntimacy,
      },
      select: CONVERSATION_SELECT,
    });
    await db.character.update({ where: { id: characterId }, data: { chatCount: { increment: 1 } } });

    return NextResponse.json({ conversation }, { status: 201 });
  } catch (error) {
    logRouteError('POST /api/conversations', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
