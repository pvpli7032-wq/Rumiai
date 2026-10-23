/**
 * Locale routing and copy — 统一出口。
 *
 * 实现按职责分开：
 * - i18n/locales.ts       语言清单、html lang、语言菜单标签、isLocale
 * - i18n/types.ts         词典结构
 * - i18n/landing-copy.ts  落地页成块文案（中/英/泰）
 * - i18n/dictionaries.ts  基础词典
 * - i18n/pulled.ts        线上站点抓取的词典覆盖与查表
 * - i18n/format.ts        紧凑数字、站点地址、hreflang alternates
 *
 * 调用方一律 `import {...} from '@/lib/i18n'`，拆文件不影响任何调用点。
 */

export {LOCALES, DEFAULT_LOCALE, HTML_LANG, LOCALE_LABELS, isLocale, type Locale} from '@rumiai/contracts/i18n/locales';
export {getDictionary} from '@web/lib/i18n/pulled';
export {compactNumber, SITE_URL, alternateLanguages} from '@rumiai/contracts/i18n/format';
