import thPulled from './dictionaries/th.json';
import enPulled from './dictionaries/en.json';
import vnPulled from './dictionaries/vn.json';
import phPulled from './dictionaries/ph.json';
import jaPulled from './dictionaries/ja.json';
import esPulled from './dictionaries/es.json';
import ptPulled from './dictionaries/pt.json';
import zhPulled from './dictionaries/zh.json';
import zhTwPulled from './dictionaries/zh-tw.json';
import koPulled from './dictionaries/ko.json';
import {DICTIONARIES} from './dictionaries';
import type {Dictionary} from './types';
import type {Locale} from './locales';
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
  zh: zhPulled,
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
  const pulled = locale === 'zh' ? undefined : PULLED[locale];
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
