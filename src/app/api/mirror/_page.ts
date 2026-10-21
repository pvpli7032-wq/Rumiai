import {identityOf, listMirrorCharacters, quotaOf, readConfigFor, readMyMirrorResults, toRulesView} from '@/lib/mirror';
import type {MirrorCookieWrite, MirrorOwnerView, MirrorRequestStateLike} from '@/lib/mirror';
import type {MirrorCharacterOption, MirrorQuota, MirrorRules} from '@/lib/mirror';
import {MIRROR_QUOTA_COOKIE, MIRROR_SUBJECT_COOKIE} from '@/lib/mirror';
import {newMirrorSubject} from '@/lib/mirror';
import {mirrorDayKey, readMirrorUsage} from '@/lib/mirror';

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** 首页与 GET /api/mirror 共用的初始化数据。 */
export type MirrorPagePayload = {
  characters: MirrorCharacterOption[];
  rules: MirrorRules;
  quota: MirrorQuota;
  mine: MirrorOwnerView[];
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
  return {characters, rules: toRulesView(config), quota: quotaOf({...state, subject}, config, subject), mine, cookies};
}
