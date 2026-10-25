import {NextResponse} from 'next/server';
import {readDiscoverProjection} from '@rumiai/backend/workflows/discover-projection';
import {readExploreCatalog} from '@rumiai/backend/modules/discovery/read-service';
import {logRouteError} from '@rumiai/backend/infrastructure/logging/logger';
import type {ExploreProjection} from '@rumiai/contracts/public-api';
export const dynamic='force-dynamic';
export async function GET(request:Request){
  try {
    if (new URL(request.url).searchParams.get('view') === 'discover') {
      return NextResponse.json(await readDiscoverProjection(), {headers: {'Cache-Control': 'no-store'}});
    }
    const raw=new URL(request.url).searchParams.get('take');
    const take=raw&&/^\d+$/.test(raw)?Math.min(60,Math.max(1,Number(raw))):60;
    const result: ExploreProjection = await readExploreCatalog(take);
    return NextResponse.json(result,{headers:{'Cache-Control':'public, max-age=60, s-maxage=300'}});
  } catch(error) {
    logRouteError('GET /api/explore',error);
    return NextResponse.json({error:'Internal server error'},{status:500});
  }
}
