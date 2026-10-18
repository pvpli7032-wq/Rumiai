import { NextResponse } from 'next/server';
import { logRouteError } from '@/lib/logger';
import { getAuthUser } from '@/lib/auth';
import { CreatorCharacterError, deleteCreatorCharacter, updateCreatorCharacter } from '@/lib/characters/creator-service';
import { CharacterCatalogError, readCharacterDetail } from '@/lib/characters/catalog-service';

export async function GET(request: Request, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;

  try {
    const authUser = await getAuthUser(request);
    const payload = await readCharacterDetail(params.id, authUser?.userId);
    return NextResponse.json({ character: payload, ...payload });
  } catch (error) {
    if (error instanceof CharacterCatalogError) return NextResponse.json({ error: error.message }, { status: error.status });
    logRouteError('GET /api/characters/[id]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(request: Request, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;

  try {
    const authUser = await getAuthUser(request);
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let body: unknown;
    try { body = await request.json(); } catch { return NextResponse.json({ error: '角色数据格式不正确。' }, { status: 400 }); }
    const updated = await updateCreatorCharacter(authUser.userId, params.id, body);
    return NextResponse.json({ character: updated, ...updated });
  } catch (error) {
    if (error instanceof CreatorCharacterError) return NextResponse.json({ error: error.message }, { status: error.status });
    logRouteError('PUT /api/characters/[id]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;

  try {
    const authUser = await getAuthUser(request);
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    return NextResponse.json(await deleteCreatorCharacter(authUser.userId, params.id));
  } catch (error) {
    if (error instanceof CreatorCharacterError) return NextResponse.json({ error: error.message }, { status: error.status });
    logRouteError('DELETE /api/characters/[id]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
