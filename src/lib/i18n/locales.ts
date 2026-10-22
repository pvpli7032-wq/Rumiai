/**
 * Locale routing and copy, matching the live site's URL shape.
 *
 * khuiai.com serves every page under a locale segment — /th, /th/about,
 * /th/explore, /th/terms-and-policy, /th/character/{id} — across ten locales, with
 * a sitemap index and hreflang alternates. This file is the single source for that
 * list so routing, metadata and the sitemap cannot drift apart.
 *
 * Only th and en are translated here. The other eight locales resolve to English
 * so their URLs work and are indexable, but they still need real translations —
 * they are deliberately not machine-translated in code.
 */

export const LOCALES = ['th', 'en', 'vn', 'ph', 'ja', 'es', 'pt', 'zh', 'zh-tw', 'ko'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'zh';

/** `lang` / `hreflang` attribute for a locale — the segment is not always valid BCP 47. */
export const HTML_LANG: Record<Locale, string> = {
  th: 'th-TH',
  en: 'en',
  vn: 'vi-VN',
  ph: 'fil-PH',
  ja: 'ja-JP',
  es: 'es',
  pt: 'pt',
  zh: 'zh-CN',
  'zh-tw': 'zh-TW',
  ko: 'ko-KR',
};

export const LOCALE_LABELS: Record<Locale, { flag: string; short: string; name: string }> = {
  th: { flag: '🇹🇭', short: 'TH', name: 'ไทย' },
  en: { flag: '🇬🇧', short: 'EN', name: 'English' },
  vn: { flag: '🇻🇳', short: 'VN', name: 'Tiếng Việt' },
  ph: { flag: '🇵🇭', short: 'PH', name: 'Filipino' },
  ja: { flag: '🇯🇵', short: 'JA', name: '日本語' },
  es: { flag: '🇪🇸', short: 'ES', name: 'Español' },
  pt: { flag: '🇵🇹', short: 'PT', name: 'Português' },
  zh: { flag: '🇨🇳', short: 'ZH', name: '简体中文' },
  'zh-tw': { flag: '🇹🇼', short: 'TW', name: '繁體中文' },
  ko: { flag: '🇰🇷', short: 'KO', name: '한국어' },
};

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}
