import {NextResponse} from 'next/server';
import {listPublicCharacterPosts,readPublicCharacter,resolveCharacterTagLabels} from '@rumiai/backend/modules/characters/catalog-service';
import {logRouteError} from '@rumiai/backend/infrastructure/logging/logger';
export const dynamic='force-dynamic';
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){try{const {id}=await params;const character=await readPublicCharacter(id);if(!character)return NextResponse.json({error:'Not found',code:'NOT_FOUND'},{status:404});const [tagLabels,communityPosts]=await Promise.all([resolveCharacterTagLabels(character.tags),listPublicCharacterPosts(character.id)]);return NextResponse.json({character,tagLabels,communityPosts},{headers:{'Cache-Control':'public, max-age=60, s-maxage=300'}});}catch(error){logRouteError('GET /api/public-character/[id]',error);return NextResponse.json({error:'Internal server error'},{status:500});}}
