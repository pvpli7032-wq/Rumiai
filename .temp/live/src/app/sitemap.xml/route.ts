import { buildSitemapIndex, xmlResponse } from '@/lib/sitemap';
import { logRouteError } from '@/lib/logger';

export const revalidate = 3600;

export async function GET() {
  try {
    return xmlResponse(await buildSitemapIndex());
  } catch (error) {
    logRouteError('GET /sitemap.xml', error);
    return new Response('Internal server error', { status: 500 });
  }
}
