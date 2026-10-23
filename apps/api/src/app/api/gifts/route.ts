import {NextResponse} from 'next/server';
import {readPublicGiftCatalog} from '@rumiai/backend/modules/gifts/catalog-service';
import {logRouteError} from '@rumiai/backend/infrastructure/logging/logger';

export const dynamic='force-dynamic';
export async function GET(){
  try{return NextResponse.json({gifts:await readPublicGiftCatalog()},{headers:{'Cache-Control':'public, max-age=60, stale-while-revalidate=300'}});}
  catch(error){logRouteError('GET /api/gifts',error);return NextResponse.json({error:'礼物目录暂时不可用。'},{status:500});}
}
