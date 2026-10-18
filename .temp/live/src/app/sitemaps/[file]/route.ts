import { buildCharacterSitemap, buildStaticSitemap, xmlResponse } from '@/lib/sitemap';
import { logRouteError } from '@/lib/logger';

export const revalidate = 3600;

/** Serves /sitemaps/sitemap-static.xml and /sitemaps/sitemap-characters-N.xml. */
export async function GET(_request: Request, { params: paramsPromise }: { params: Promise<{ file: string }> }) {
  const params = await paramsPromise;

  try {
    if (params.file === 'sitemap-static.xml') {
      return xmlResponse(buildStaticSitemap());
    }

    const match = /^sitemap-characters-(\d+)\.xml$/.exec(params.file);
    if (match) {
      const body = await buildCharacterSitemap(Number(match[1]));
      // A page past the end is not an error the crawler should retry — it is absent.
      if (!body) return new Response('Not found', { status: 404 });
      return xmlResponse(body);
    }

    return new Response('Not found', { status: 404 });
  } catch (error) {
    logRouteError('GET /sitemaps/[file]', error);
    return new Response('Internal server error', { status: 500 });
  }
}
