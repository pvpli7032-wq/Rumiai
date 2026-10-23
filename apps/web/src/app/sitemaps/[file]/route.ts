import {fetchPublicApiText, PublicApiError} from '@/lib/server-api';

export const revalidate = 3600;

/** Serves /sitemaps/sitemap-static.xml and /sitemaps/sitemap-characters-N.xml. */
export async function GET(_request: Request, { params: paramsPromise }: { params: Promise<{ file: string }> }) {
  const params = await paramsPromise;

  try {
    const body=await fetchPublicApiText(`/api/seo/sitemap?file=${encodeURIComponent(params.file)}`);
    return new Response(body,{headers:{'Content-Type':'application/xml; charset=utf-8','Cache-Control':'public, max-age=3600, s-maxage=3600'}});
  } catch(error) {
    if(error instanceof PublicApiError && error.status===404)return new Response('Not found',{status:404});
    return new Response('Internal server error',{status:500});
  }
}
