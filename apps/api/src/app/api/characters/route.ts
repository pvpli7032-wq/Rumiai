import { NextResponse } from 'next/server';
import { logRouteError } from '@rumiai/backend/infrastructure/logging/logger';
import { getAuthUser } from '@rumiai/backend/infrastructure/auth/auth';
import { CharacterCatalogError, listCharacters, readCharacterCatalogPage } from '@rumiai/backend/modules/characters/catalog-service';
import { createCreatorCharacter, CreatorCharacterError } from '@rumiai/backend/modules/characters/creator-service';

function characterError(error: unknown) {
  if (error instanceof CharacterCatalogError || error instanceof CreatorCharacterError) {
    return NextResponse.json({error: error.message}, {status: error.status});
  }
  return null;
}

export async function GET(request: Request) {
  try {
    const {searchParams} = new URL(request.url);
    const scope = searchParams.get('scope');
    const auth = scope ? await getAuthUser(request) : null;
    const options = {
      search: searchParams.get('search') || '',
      scope,
      sort: searchParams.get('sort') || 'popular',
      tags: searchParams.getAll('tag'),
      userId: auth?.userId,
    };
    const characters = searchParams.get('page') === '1'
      ? await readCharacterCatalogPage({...options, limit: searchParams.has('limit') ? Number(searchParams.get('limit')) : undefined, cursor: searchParams.get('cursor')})
      : await listCharacters(options);
    return NextResponse.json(characters, {headers: {'Cache-Control': 'private, no-store'}});
  } catch (error) {
    const response = characterError(error);
    if (response) return response;
    logRouteError('GET /api/characters', error);
    return NextResponse.json({error: 'Internal server error'}, {status: 500});
  }
}

export async function POST(request: Request) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({error: 'Unauthorized'}, {status: 401});
    let input: unknown;
    try { input = await request.json(); }
    catch { return NextResponse.json({error: '角色数据格式不正确。'}, {status: 400}); }
    return NextResponse.json(await createCreatorCharacter(auth.userId, input), {status: 201});
  } catch (error) {
    const response = characterError(error);
    if (response) return response;
    logRouteError('POST /api/characters', error);
    return NextResponse.json({error: 'Internal server error'}, {status: 500});
  }
}
