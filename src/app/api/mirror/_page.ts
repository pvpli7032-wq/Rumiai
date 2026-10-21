import {identityOf, listMirrorCharacters, quotaOf, readConfigFor, readMyMirrorResults, toRulesView} from '@/lib/mirror';
import type {MirrorCookieWrite, MirrorOwnerView, MirrorRequestStateLike} from '@/lib/mirror';
import type {MirrorCharacterOption, MirrorExampleView, MirrorQuota, MirrorRules} from '@/lib/mirror';
import {MIRROR_QUOTA_COOKIE, MIRROR_SUBJECT_COOKIE} from '@/lib/mirror';
import {newMirrorSubject} from '@/lib/mirror';
import {mirrorDayKey, readMirrorUsage} from '@/lib/mirror';
import {exampleForCharacter} from '@/lib/mirror/examples';

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** 首页与 GET /api/mirror 共用的初始化数据。 */
export type MirrorPagePayload = {
  characters: MirrorCharacterOption[];
  rules: MirrorRules;
  /** 按 questionCount 取好的提问文本；条数不足时前端明确提示，不补默认题。 */
  questions: string[];
  quota: MirrorQuota;
  mine: MirrorOwnerView[];
  /** 与上面角色对应的示例结果（只含配了的角色），前台展示时标「示例」。 */
  examples: MirrorExampleView[];
  /** 运营一共配了几条示例（含没进当前名单的角色），后台配置页据此显示状态。 */
  exampleCount: number;
  cookies: MirrorCookieWrite[];
};

/**
 * 匿名额度要走 Cookie 双路计数，第一次访问就得由服务端签发主体标识；
 * 页面是 Server Component 不能写 Cookie，所以由页面渲染后的初始化请求签发。
 */
export async function readPageView(state: MirrorRequestStateLike): Promise<MirrorPagePayload> {
  const config = await readConfigFor(state.userId);
  const subject = state.userId ? null : state.subject ?? newMirrorSubject();
  const day = mirrorDayKey(new Date(), config.timezone);
  const [characters, mine] = await Promise.all([listMirrorCharacters(), readMyMirrorResults(state.userId, subject)]);
  const cookies: MirrorCookieWrite[] = [];
  if (subject) {
    if (!state.subject) cookies.push({name: MIRROR_SUBJECT_COOKIE, value: subject, maxAge: COOKIE_MAX_AGE, httpOnly: true});
    const used = readMirrorUsage(identityOf({...state, subject}, subject, config.timezone), day).cookieUsed;
    cookies.push({name: MIRROR_QUOTA_COOKIE, value: `${day}:${used}`, maxAge: COOKIE_MAX_AGE, httpOnly: false});
  }
  // 示例只为当前展示的角色准备：配了但不在名单里的不带到前台，避免展示点不到的角色。
  const examples = characters.flatMap(character => {
    const view = exampleForCharacter(config.exampleResults, character.id);
    return view ? [view] : [];
  });
  return {
    characters,
    rules: toRulesView(config),
    questions: config.questions,
    quota: quotaOf({...state, subject}, config, subject),
    mine,
    examples,
    exampleCount: config.exampleResults.length,
    cookies,
  };
}
