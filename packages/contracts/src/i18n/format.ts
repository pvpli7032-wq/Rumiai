import {HTML_LANG, LOCALES} from '@rumiai/contracts/i18n/locales';

/** 305012 -> "305k", 3120000 -> "3.1m" — the compact form the cards use. */
export function compactNumber(value: number): string {
  if (value >= 1_000_000) {
    const m = value / 1_000_000;
    return `${m >= 10 ? Math.round(m) : Math.round(m * 10) / 10}m`;
  }
  if (value >= 1_000) {
    const k = value / 1_000;
    return `${k >= 100 ? Math.round(k) : Math.round(k * 10) / 10}k`;
  }
  return String(value);
}

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

/** hreflang alternates for a path such as '/about' (leading slash, no locale). */
export function alternateLanguages(path: string): Record<string, string> {
  const suffix = path === '/' ? '' : path;
  return Object.fromEntries(LOCALES.map(l => [HTML_LANG[l], `${SITE_URL}/${l}${suffix}`]));
}
