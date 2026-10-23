import {NextResponse} from 'next/server';
import {readPublishedAnnouncements} from '@rumiai/backend/modules/site-content/public-service';
export const dynamic='force-dynamic';
export async function GET(){return NextResponse.json(await readPublishedAnnouncements(),{headers:{'Cache-Control':'public, max-age=60, s-maxage=300'}});}
