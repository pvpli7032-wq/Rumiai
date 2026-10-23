import {NextResponse} from 'next/server';
import {buildCharacterSitemap,buildSitemapIndex,buildStaticSitemap} from '@rumiai/backend/infrastructure/seo/sitemap';
export const dynamic='force-dynamic';
export async function GET(request:Request){const file=new URL(request.url).searchParams.get('file');const body=file===null?await buildSitemapIndex():file==='sitemap-static.xml'?buildStaticSitemap():/^sitemap-characters-\d+\.xml$/.test(file)?await buildCharacterSitemap(Number(file.match(/(\d+)/)?.[1])):null;if(body===null)return new NextResponse('Not found',{status:404});return new NextResponse(body,{headers:{'Content-Type':'application/xml; charset=utf-8','Cache-Control':'public, max-age=3600, s-maxage=3600'}});}
