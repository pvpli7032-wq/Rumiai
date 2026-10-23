import type { MetadataRoute } from 'next';
import { SITE_URL } from '@web/lib/i18n';

/** Mirrors the live site's robots.txt. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/api/', '/_next/', '/static/', '/admin'] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
