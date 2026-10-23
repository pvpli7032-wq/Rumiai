import {fetchPublicApiText} from '@/lib/server-api';

export const revalidate = 3600;

export async function GET() {try{return new Response(await fetchPublicApiText('/api/seo/sitemap'),{headers:{'Content-Type':'application/xml; charset=utf-8','Cache-Control':'public, max-age=3600, s-maxage=3600'}});}catch{return new Response('Internal server error',{status:500});}}
