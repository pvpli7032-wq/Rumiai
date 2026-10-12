import appCopy from './i18n/app-zh.json';
import thai from './i18n/dictionaries/th.json';
import chinese from './i18n/dictionaries/zh.json';

const copy: Record<string, string> = { ...appCopy };
for (const [key, original] of Object.entries(thai)) {
  const translated = (chinese as Record<string, string>)[key];
  if (translated && translated !== '$undefined' && copy[original] === undefined) copy[original] = translated;
}

/** UI copy only. Never use this to rewrite user content or API enum identifiers. */
export function zhText(text: string): string {
  return copy[text] ?? text;
}

const errors:Record<string,string>={'Unauthorized':'请先登录','Forbidden':'没有访问权限','Invalid credentials':'邮箱或密码不正确','Email already in use':'邮箱已被注册','Email or username already in use':'邮箱或用户名已被使用','Username already in use':'用户名已被使用','Network error':'网络连接失败，请重试','Internal server error':'服务暂时不可用，请稍后重试','Already checked in today':'今天已经签到','Insufficient coins':'测试金币不足','Password is too long':'密码过长','Missing required fields':'请填写必填项'};
export function zhError(text:string):string{if(!text)return '';return errors[text]??(/[\u4e00-\u9fff]/.test(text)?text:'操作失败，请稍后重试。');}
