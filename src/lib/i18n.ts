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
  landing: LandingCopy;
};


/** 公开落地页的成块文案。每块都完整给出，避免页面里散落字符串。 */
type LandingCopy = {
  headline: string;
  subhead: string;
  primaryCta: string;
  secondaryCta: string;
  aiNotice: string;
  featuredTitle: string;
  featuredHint: string;
  featuredMore: string;
  stepsTitle: string;
  steps: { title: string; body: string }[];
  sampleTitle: string;
  sampleHint: string;
  sample: { user: string; character: string };
  safetyTitle: string;
  safety: string[];
  faqTitle: string;
  faq: { q: string; a: string }[];
  closingTitle: string;
  closingBody: string;
};

const LANDING_ZH: LandingCopy = {
  headline: '和你喜欢的角色，聊出属于你的故事',
  subhead: '原创角色、即时对话、圈子社区。挑一个角色开口，故事就从这一句开始。',
  primaryCta: '免费开始对话',
  secondaryCta: '先看看有哪些角色',
  aiNotice: '对话由 AI 生成，内容为虚构演绎，请勿当作真实人物言论。',
  featuredTitle: '热门角色',
  featuredHint: '现在最多人在聊的几个',
  featuredMore: '查看全部角色',
  stepsTitle: '三步就开始',
  steps: [
    {title: '挑一个角色', body: '从原创角色里挑，或者按类型、标签找到对味的那一个。'},
    {title: '直接开口说', body: '不用写设定，像发消息一样打字。角色会记住你们聊过的内容。'},
    {title: '留下或创造', body: '收藏、点赞、关注创作者；也可以自己写一个角色让别人来聊。'},
  ],
  sampleTitle: '一段示例对话',
  sampleHint: '示例文案，用于说明对话形态，非真实生成内容',
  sample: {user: '今天有点累，能陪我说说话吗？', character: '那就先别想工作的事。坐下，从你最想吐槽的那件说起——我在听。'},
  safetyTitle: '安全与合规',
  safety: [
    '角色与社区内容经过审核后才公开，发现不当内容可在页面内举报。',
    'AI 生成内容均有标识，不冒充真人，也不提供医疗、法律等专业结论。',
    '注册需确认年龄与条款；未成年人不适合使用成人向角色。',
    '你的对话默认只有自己可见，可随时导出数据或注销账号。',
  ],
  faqTitle: '常见问题',
  faq: [
    {q: '需要付费吗？', a: '浏览角色和开始对话不收费。金币用于部分增值功能，充值流程会明确标注金额与渠道。'},
    {q: '对话是真人吗？', a: '不是。对面是 AI 模型按角色设定生成的回复，不是真人，也不代表平台观点。'},
    {q: '我能自己创建角色吗？', a: '可以。注册后进入创作页填写角色设定与开场，提交审核通过后即可在发现页被其他人看到。'},
    {q: '别人能看到我的对话吗？', a: '默认不能。对话只属于你自己；只有你主动举报时，相关片段才会提交给审核人员。'},
    {q: '发现不当内容怎么办？', a: '角色详情页和消息气泡上都有举报入口，提交后会进入后台审核队列。'},
  ],
  closingTitle: '现在就开始',
  closingBody: '注册只要一个邮箱，几秒钟就能和第一个角色说上话。',
};

const LANDING_EN: LandingCopy = {
  headline: 'Talk your own story into being',
  subhead: 'Original characters, instant conversation, a community around them. Pick one and say hello.',
  primaryCta: 'Start chatting free',
  secondaryCta: 'Browse characters',
  aiNotice: 'Replies are AI-generated fiction. Do not treat them as statements by real people.',
  featuredTitle: 'Popular characters',
  featuredHint: 'What people are talking to right now',
  featuredMore: 'See all characters',
  stepsTitle: 'Three steps in',
  steps: [
    {title: 'Pick a character', body: 'Choose from original characters, or filter by type and tags until one fits.'},
    {title: 'Just start typing', body: 'No setup needed — write like a message. The character remembers what you said.'},
    {title: 'Keep it or create it', body: 'Save, like and follow creators. Or write a character of your own for others to meet.'},
  ],
  sampleTitle: 'A sample exchange',
  sampleHint: 'Illustrative copy showing the shape of a chat, not real generated content',
  sample: {user: "Long day. Got a minute to talk?", character: "Then leave work outside. Sit down and start with the part that annoyed you most — I'm listening."},
  safetyTitle: 'Safety and compliance',
  safety: [
    'Characters and community content are reviewed before they go public; anything wrong can be reported in place.',
    'AI-generated content is labelled, never impersonates a real person, and gives no medical or legal advice.',
    'Signing up requires an age and terms confirmation; adult-themed characters are not for minors.',
    'Your conversations are private by default, and you can export or delete your account at any time.',
  ],
  faqTitle: 'Questions',
  faq: [
    {q: 'Does it cost anything?', a: 'Browsing and chatting are free. Coins cover optional extras, and every top-up states its amount and channel.'},
    {q: 'Am I talking to a person?', a: 'No. Replies are generated by an AI model playing a character — not a real person, and not the platform speaking.'},
    {q: 'Can I create a character?', a: 'Yes. After signing up, fill in the character sheet and opening line; once review passes it appears in discovery.'},
    {q: 'Can anyone else see my chats?', a: 'No. Conversations belong to you; only a report you file sends the relevant excerpt to moderators.'},
    {q: 'How do I report something?', a: 'Both character pages and message bubbles carry a report entry that lands in the moderation queue.'},
  ],
  closingTitle: 'Start now',
  closingBody: 'An email is all it takes — you can be talking to your first character in seconds.',
};

const th: Dictionary = {
 landing: LANDING_EN, // 泰语落地页文案尚未翻译，先用英文

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
 landing: LANDING_EN,

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
 landing: LANDING_ZH,

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
