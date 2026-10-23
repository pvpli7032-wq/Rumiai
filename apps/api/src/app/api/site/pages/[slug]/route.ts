import {NextResponse} from 'next/server';
import {readPublishedSitePage} from '@rumiai/backend/modules/site-content/public-service';
export const dynamic='force-dynamic';
export async function GET(_request:Request,{params}:{params:Promise<{slug:string}>}){const {slug}=await params;const page=await readPublishedSitePage(slug);return page?NextResponse.json(page,{headers:{'Cache-Control':'public, max-age=60, s-maxage=300'}}):NextResponse.json({error:'Not found',code:'NOT_FOUND'},{status:404});}
