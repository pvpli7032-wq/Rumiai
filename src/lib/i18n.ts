import thPulled from './i18n/dictionaries/th.json';
import enPulled from './i18n/dictionaries/en.json';
import vnPulled from './i18n/dictionaries/vn.json';
import phPulled from './i18n/dictionaries/ph.json';
import jaPulled from './i18n/dictionaries/ja.json';
import esPulled from './i18n/dictionaries/es.json';
import ptPulled from './i18n/dictionaries/pt.json';
import zhPulled from './i18n/dictionaries/zh.json';
import zhTwPulled from './i18n/dictionaries/zh-tw.json';
import koPulled from './i18n/dictionaries/ko.json';

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

type Dictionary = {
  siteTitle: string;
  siteDescription: string;
  chatNow: string;
  signIn: string;
  exploreHeadline: (count: string) => string;
  exploreSubhead: string;
  charactersSection: string;
  aboutTitle: string;
  aboutHeading: string;
  aboutBody: string[];
  termsTitle: string;
  termsHeading: string;
  characterTitleSuffix: string;
  chatsLabel: string;
  conversationsLabel: string;
  prevBanner: string;
  nextBanner: string;
  goToBanner: (n: number) => string;
  bannerNav: string;
  notFound: string;
  /** The combined sign-in / sign-up page at /{locale}/auth. */
  authTitle: string;
  authHeading: string;
  authSubhead: string;
  signUp: string;
  emailLabel: string;
  passwordLabel: string;
  displayNameLabel: string;
  authSwitchToSignUp: string;
  authSwitchToSignIn: string;
  authSubmitting: string;
  authGenericError: string;
};

const th: Dictionary = {
  siteTitle: '星伴 - แชทบอทบทบาทสมมติภาษาไทย | AI เพื่อนคุยที่เข้าใจคุณ',
  siteDescription: 'สร้างตัวละคร คุยกับ AI และสำรวจโลกแห่งจินตนาการไร้ขีดจำกัด',
  chatNow: 'คุยเลย',
  signIn: 'เข้าสู่ระบบ',
  exploreHeadline: count => `มากกว่า ${count} ตัวละคร ให้คุณเลือกคุยอย่างจุใจ`,
  exploreSubhead: 'สร้างตัวละคร คุยกับ AI และสำรวจโลกแห่งจินตนาการไร้ขีดจำกัด',
  charactersSection: 'ตัวละครบน 星伴',
  aboutTitle: 'เกี่ยวกับ 星伴 - แชทบอทภาษาไทยสำหรับบทบาทสมมติ | 星伴 - แชทบอทภาษาไทย',
  aboutHeading: 'เกี่ยวกับ 星伴',
  aboutBody: [
    '星伴 คือแพลตฟอร์มแชทบทบาทสมมติภาษาไทย ที่ให้คุณคุยกับตัวละคร AI ได้อย่างเป็นธรรมชาติ',
    'เลือกจากตัวละครที่ครีเอเตอร์สร้างไว้ หรือสร้างตัวละครของคุณเองพร้อมกำหนดบุคลิกและเรื่องราวเบื้องหลัง',
    'มีระบบเหรียญ เช็คอินรายวัน ภารกิจ และการส่งของขวัญให้ตัวละครที่คุณชอบ',
  ],
  termsTitle: 'ข้อกำหนดและนโยบายความเป็นส่วนตัว | 星伴',
  termsHeading: 'ข้อกำหนด & ความเป็นส่วนตัว',
  characterTitleSuffix: '星伴 - คุยเอไอ | 星伴 - แชทบอทภาษาไทย',
  chatsLabel: 'ข้อความ',
  conversationsLabel: 'ห้องแชท',
  prevBanner: 'แบนเนอร์ก่อนหน้า',
  nextBanner: 'แบนเนอร์ถัดไป',
  goToBanner: n => `ไปที่แบนเนอร์ ${n}`,
  bannerNav: 'การนำทางแบนเนอร์',
  notFound: 'ไม่พบตัวละครนี้',
  authTitle: 'เข้าสู่ระบบ / สมัครสมาชิก | 星伴',
  authHeading: 'เข้าสู่ 星伴',
  authSubhead: 'คุยกับตัวละคร AI ภาษาไทยได้ทันที',
  signUp: 'สมัครสมาชิกฟรี',
  emailLabel: 'อีเมล',
  passwordLabel: 'รหัสผ่าน',
  displayNameLabel: 'ชื่อที่ใช้แสดง',
  authSwitchToSignUp: 'ยังไม่มีบัญชี? สมัครสมาชิกฟรี',
  authSwitchToSignIn: 'มีบัญชีอยู่แล้ว? เข้าสู่ระบบ',
  authSubmitting: 'กำลังดำเนินการ...',
  authGenericError: 'ดำเนินการไม่สำเร็จ กรุณาลองอีกครั้ง',
};

const en: Dictionary = {
  siteTitle: '星伴 - Thai Roleplay Chatbot | An AI companion that gets you',
  siteDescription: 'Create characters, chat with AI, and explore a world of limitless imagination.',
  chatNow: 'Start chatting',
  signIn: 'Sign in',
  exploreHeadline: count => `More than ${count} characters to chat with`,
  exploreSubhead: 'Create characters, chat with AI, and explore a world of limitless imagination.',
  charactersSection: 'Characters on 星伴',
  aboutTitle: 'About 星伴 - Thai roleplay chatbot | 星伴',
  aboutHeading: 'About 星伴',
  aboutBody: [
    '星伴 is a Thai-language roleplay chat platform where you talk to AI characters that feel natural.',
    'Pick from characters made by creators, or build your own with its own personality and backstory.',
    'Coins, daily check-ins, missions and gifting let you support the characters you love.',
  ],
  termsTitle: 'Terms and Privacy Policy | 星伴',
  termsHeading: 'Terms & Privacy',
  characterTitleSuffix: '星伴',
  chatsLabel: 'messages',
  conversationsLabel: 'chats',
  prevBanner: 'Previous banner',
  nextBanner: 'Next banner',
  goToBanner: n => `Go to banner ${n}`,
  bannerNav: 'Banner navigation',
  notFound: 'Character not found',
  authTitle: 'Sign in / Sign up | 星伴',
  authHeading: 'Welcome to 星伴',
  authSubhead: 'Start chatting with Thai AI characters right away.',
  signUp: 'Sign up free',
  emailLabel: 'Email',
  passwordLabel: 'Password',
  displayNameLabel: 'Display name',
  authSwitchToSignUp: 'No account yet? Sign up free',
  authSwitchToSignIn: 'Already have an account? Sign in',
  authSubmitting: 'Working...',
  authGenericError: 'That did not work. Please try again.',
};

const zh: Dictionary = {
 siteTitle:'星伴 · AI 角色社区',siteDescription:'发现原创角色，开启中文 AI 对话',chatNow:'开始聊天',signIn:'登录',exploreHeadline:count=>'探索 '+count+' 位原创角色',exploreSubhead:'创造你的角色，开启一段新的故事',charactersSection:'发现角色',aboutTitle:'关于星伴',aboutHeading:'关于星伴',aboutBody:['星伴是基于 MIT 开源项目二次开发的中文 AI 角色社区。','你可以创建原创角色、发表评论并开启 AI 对话。','当前为内部测试版本，充值仅为明确标注的模拟流程。'],termsTitle:'测试条款与隐私说明',termsHeading:'测试条款与隐私说明',characterTitleSuffix:'星伴',chatsLabel:'消息',conversationsLabel:'对话',prevBanner:'上一张',nextBanner:'下一张',goToBanner:n=>'第 '+n+' 张',bannerNav:'轮播导航',notFound:'角色不存在',authTitle:'登录 / 注册 · 星伴',authHeading:'欢迎来到星伴',authSubhead:'发现原创角色，开启中文 AI 对话',signUp:'注册',emailLabel:'邮箱',passwordLabel:'密码',displayNameLabel:'昵称',authSwitchToSignUp:'没有账号？注册',authSwitchToSignIn:'已有账号？登录',authSubmitting:'正在提交…',authGenericError:'操作失败，请重试'
};
const DICTIONARIES: Partial<Record<Locale, Dictionary>> = { th, en, zh };

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
  const base = DICTIONARIES[locale] ?? en;
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
