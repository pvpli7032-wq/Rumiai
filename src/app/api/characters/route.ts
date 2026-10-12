import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logRouteError } from '@/lib/logger';
import { validateCharacter } from '@/lib/characters/validation';
import { getAuthUser } from '@/lib/auth';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';
    const scope = searchParams.get('scope');
    const auth = scope ? await getAuthUser(request) : null;
    if (scope && !['mine', 'bookmarked'].includes(scope)) return NextResponse.json({ error: '未知角色列表类型。' }, { status: 400 });
    if (scope && !auth) return NextResponse.json({ error: '请先登录。' }, { status: 401 });

    const sort = searchParams.get('sort') || 'popular';
    if (!['new','popular'].includes(sort)) return NextResponse.json({error:'未知排序方式。'},{status:400});
    const tags = searchParams.getAll('tag').filter(Boolean).slice(0,10);
    const characters = await db.character.findMany({
      where: {
        ...(scope === 'mine' ? { creatorId: auth!.userId } : { isPublic: true, reviewStatus: 'APPROVED' }),
        ...(scope === 'bookmarked' && { bookmarks: { some: { userId: auth!.userId } } }),
        ...(tags.length && {AND:tags.map(tag=>({OR:[{tags:tag},{tags:{startsWith:tag+','}},{tags:{endsWith:','+tag}},{tags:{contains:','+tag+','}}]}))}),
        ...(search && { OR: [{ name: { contains: search } }, { tagline: { contains: search } }] }),
      },
      orderBy: sort === 'new' ? [{createdAt:'desc'},{id:'asc'}] : [{chatCount:'desc'},{id:'asc'}],
      take: scope ? 100 : 50,
      select: { id: true, name: true, tagline: true, personality: true, background: true, greeting: true, avatarUrl: true, creatorId: true, isPublic: true, publicationRequested: true, reviewStatus: true, reviewReason: true, copyrightStatement: true, chatCount: true, isExclusive: true, badges: true, tags: true, createdAt: true },
    });
    if(scope==='mine'){
      const reports=await db.report.groupBy({by:['targetId'],where:{targetType:'CHARACTER',status:{in:['OPEN','REVIEWING']},targetId:{in:characters.map(c=>c.id)}},_count:true});
      return NextResponse.json(characters.map(c=>({...c,openReportCount:reports.find(row=>row.targetId===c.id)?._count||0})));
    }
    return NextResponse.json(characters);
  } catch (error) {
    logRouteError('GET /api/characters', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const authUser = await getAuthUser(request);
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let input: unknown;
    try { input = await request.json(); } catch { return NextResponse.json({ error: '角色数据格式不正确。' }, { status: 400 }); }
    const validated = validateCharacter(input, true);
    if (validated.error) return NextResponse.json({ error: validated.error }, { status: 400 });
    const body = { ...(input as Record<string, any>), ...validated.data };
    const { name, tagline, personality, background, greeting, tags, badges, isExclusive } = body;
    if ((body.isPublic ?? body.is_public) === true && !body.copyrightStatement?.trim()) return NextResponse.json({ error: '申请公开前请填写角色及素材版权声明。' }, { status: 400 });
    // Clients send snake_case for these two (matching avatar_url / package_id
    // elsewhere in the API). Reading only the camelCase form silently published
    // characters their creator had asked to keep private.
    const avatarUrl = body.avatarUrl ?? body.avatar_url;
    const isPublic = body.isPublic ?? body.is_public;
    // Detail-view fields, snake_case accepted alongside camelCase like the rest.
    const roleTemplate = body.roleTemplate ?? body.role_template ?? null;
    const scenario = body.scenario ?? null;
    const isAdult = (body.isAdult ?? body.is_adult) === true;
    const relationshipStatus = body.relationshipStatus ?? body.relationship_status ?? null;
    // Not a percentage: the live chat page shows a romance value of 1100 with its bar
    // about half filled, so the fill is relative to the current status tier's band.
    // Clamping to 100 here was wrong. Only reject negatives and absurd values.
    const MAX_METER = 1_000_000;
    const clampMeter = (value: unknown) =>
      typeof value === 'number' && Number.isFinite(value)
        ? Math.min(MAX_METER, Math.max(0, Math.round(value)))
        : 0;
    const initialRomance = clampMeter(body.initialRomance ?? body.initial_romance);
    const initialIntimacy = clampMeter(body.initialIntimacy ?? body.initial_intimacy);
    if (!name || !personality) {
      return NextResponse.json({ error: 'Name and personality are required' }, { status: 400 });
    }
    if (personality.length > 1000) {
      return NextResponse.json({ error: 'Personality too long (max 1000 chars)' }, { status: 400 });
    }

    const character = await db.character.create({
      data: {
        name,
        tagline: tagline || null,
        personality,
        background: background || '',
        greeting: greeting || `你好，我是${name}。想聊些什么？`,
        avatarUrl: avatarUrl || null,
        creatorId: authUser.userId,
        isPublic: false,
        publicationRequested: isPublic === true,
        reviewStatus: isPublic === true ? 'PENDING' : 'DRAFT',
        copyrightStatement: body.copyrightStatement || null,
        tags: tags || null,
        badges: badges || null,
        isExclusive: isExclusive === true,
        roleTemplate,
        scenario,
        isAdult,
        relationshipStatus,
        initialRomance,
        initialIntimacy,
      },
    });
    return NextResponse.json({ character }, { status: 201 });
  } catch (error) {
    logRouteError('POST /api/characters', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
