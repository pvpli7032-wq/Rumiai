import thPulled from '@web/lib/i18n/dictionaries/th.json';
import enPulled from '@web/lib/i18n/dictionaries/en.json';
import vnPulled from '@web/lib/i18n/dictionaries/vn.json';
import phPulled from '@web/lib/i18n/dictionaries/ph.json';
import jaPulled from '@web/lib/i18n/dictionaries/ja.json';
import esPulled from '@web/lib/i18n/dictionaries/es.json';
import ptPulled from '@web/lib/i18n/dictionaries/pt.json';
import zhTwPulled from '@web/lib/i18n/dictionaries/zh-tw.json';
import koPulled from '@web/lib/i18n/dictionaries/ko.json';
import {DICTIONARIES} from '@web/lib/i18n/dictionaries';
import type {Dictionary} from '@web/lib/i18n/types';
import type {Locale} from '@rumiai/contracts/i18n/locales';
/**
 * Translations pulled from the live site by scripts/pull-i18n-dictionaries.mjs, keyed
 * as the site keys them. They cover far more ground than the handful of fields this
 * app currently renders, so only the fields with a confident counterpart are mapped —
 * guessing at the rest would put the wrong words on screen.
 *
 * Everything unmapped still falls back to English for the eight locales without
 * written copy here, which is visible rather than silently wrong.
 */
const PULLED: Partial<Record<Locale, Record<string, string>>> = {
  th: thPulled,
  en: enPulled,
  vn: vnPulled,
  ph: phPulled,
  ja: jaPulled,
  es: esPulled,
  pt: ptPulled,
  'zh-tw': zhTwPulled,
  ko: koPulled,
};

/** Dictionary field <- key used by the live site. */
const PULLED_FIELDS: Partial<Record<keyof Dictionary, string>> = {
  signIn: 'login',
  chatNow: 'startChatButton',
};

export function getDictionary(locale: Locale): Dictionary {
  const base = DICTIONARIES[locale] ?? DICTIONARIES.en!;
  // zh 有手写文案（DICTIONARIES.zh），PULLED 里没有 zh，所以这一句对 zh 自然返回 undefined。
  const pulled = PULLED[locale];
  if (!pulled) return base;

  const overrides: Partial<Dictionary> = {};
  for (const [field, key] of Object.entries(PULLED_FIELDS) as [keyof Dictionary, string][]) {
    const value = pulled[key];
    // "$undefined" appears in the payload where the site had no value for a key.
    if (typeof value === 'string' && value && value !== '$undefined') {
      (overrides as Record<string, string>)[field] = value;
    }
  }
  return { ...base, ...overrides };
}
