import {NextResponse} from 'next/server';
import {readHomeCopyOverrides} from '@rumiai/backend/modules/site-content/home-copy';
import {readPublicSiteContent} from '@rumiai/backend/modules/site-content/public-service';
import {listCharacters} from '@rumiai/backend/modules/characters/catalog-service';
import {readSettingValue} from '@rumiai/backend/modules/settings/service';
import {logRouteError} from '@rumiai/backend/infrastructure/logging/logger';
import type {HomeProjection} from '@rumiai/contracts/public-api';
export const dynamic='force-dynamic';
export async function GET(){
  try {
    const [site, rows, homeCopy, mirrorEnabled] = await Promise.all([
      readPublicSiteContent(), listCharacters({sort:'popular'}), readHomeCopyOverrides(), readSettingValue<boolean>('mirror.enabled'),
    ]);
    const characters: HomeProjection['characters'] = rows.slice(0,6).map(({id,name,tagline,personality,avatarUrl,chatCount,tags,creator}) => ({id,name,tagline,personality,avatarUrl,chatCount,tags,creator}));
    return NextResponse.json({site,characters,homeCopy,mirrorEnabled},{headers:{'Cache-Control':'no-store'}});
  } catch(error) {
    logRouteError('GET /api/home',error);
    return NextResponse.json({error:'Internal server error'},{status:500});
  }
}
