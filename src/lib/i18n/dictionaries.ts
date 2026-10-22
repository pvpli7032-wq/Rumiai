import type {Dictionary} from './types';
import {LANDING_ZH, LANDING_EN, LANDING_TH} from './landing-copy';
import type {Locale} from './locales';

const th: Dictionary = {
 landing: LANDING_TH,

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
/** 有手写文案的语言；其余语言在 getDictionary 里回落英语。 */
export const DICTIONARIES: Partial<Record<Locale, Dictionary>> = { th, en, zh };
