import { db } from '@rumiai/backend/infrastructure/database/client';
import {HTML_LANG, LOCALES} from '@rumiai/contracts/i18n/locales';
import {SITE_URL} from '@rumiai/contracts/i18n/format';

/**
 * Sitemap generation, using the same URLs the live site publishes:
 *
 *   /sitemap.xml                          index
 *   /sitemaps/sitemap-static.xml          the four marketing pages, per locale
 *   /sitemaps/sitemap-characters-N.xml    public characters, per locale
 *
 * Next's built-in `generateSitemaps` convention serves /sitemap.xml/0 instead and
 * publishes no index, so these are plain route handlers.
 */

export const CHARACTERS_PER_SITEMAP = 5_000;
const STATIC_PATHS = ['', '/about', '/explore', '/terms-and-policy'];

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** One <url> entry carrying an alternate for every locale. */
function urlEntry(path: string, lastModified: Date, changefreq: string, priority: string): string {
  const alternates = LOCALES.map(
    l =>
      `    <xhtml:link rel="alternate" hreflang="${HTML_LANG[l]}" href="${escapeXml(`${SITE_URL}/${l}${path}`)}"/>`
  ).join('\n');

  return [
    '  <url>',
    `    <loc>${escapeXml(`${SITE_URL}/${LOCALES[0]}${path}`)}</loc>`,
    `    <lastmod>${lastModified.toISOString().slice(0, 10)}</lastmod>`,
    `    <changefreq>${changefreq}</changefreq>`,
    `    <priority>${priority}</priority>`,
    alternates,
    '  </url>',
  ].join('\n');
}

function urlSet(entries: string[]): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...entries,
    '</urlset>',
    '',
  ].join('\n');
}

export function xmlResponse(body: string): Response {
  return new Response(body, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  });
}

export async function characterSitemapCount(): Promise<number> {
  const total = await db.character.count({ where: { isPublic: true, reviewStatus: 'APPROVED' } });
  return Math.max(1, Math.ceil(total / CHARACTERS_PER_SITEMAP));
}

export async function buildSitemapIndex(): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  const count = await characterSitemapCount();
  const files = ['sitemap-static.xml', ...Array.from({ length: count }, (_, i) => `sitemap-characters-${i + 1}.xml`)];

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...files.map(file =>
      [
        '  <sitemap>',
        `    <loc>${escapeXml(`${SITE_URL}/sitemaps/${file}`)}</loc>`,
        `    <lastmod>${today}</lastmod>`,
        '  </sitemap>',
      ].join('\n')
    ),
    '</sitemapindex>',
    '',
  ].join('\n');
}

export function buildStaticSitemap(): string {
  const now = new Date();
  return urlSet(STATIC_PATHS.map(path => urlEntry(path, now, 'daily', path === '' ? '1.0' : '0.8')));
}

export async function buildCharacterSitemap(page: number): Promise<string | null> {
  if (!Number.isInteger(page) || page < 1) return null;

  const characters = await db.character.findMany({
    where: { isPublic: true, reviewStatus: 'APPROVED' },
    orderBy: { createdAt: 'asc' },
    skip: (page - 1) * CHARACTERS_PER_SITEMAP,
    take: CHARACTERS_PER_SITEMAP,
    select: { id: true, updatedAt: true },
  });
  if (characters.length === 0) return null;

  return urlSet(characters.map(c => urlEntry(`/character/${c.id}`, c.updatedAt, 'weekly', '0.6')));
}
