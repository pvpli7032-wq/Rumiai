/**
 * 他眼中的你（Mirror）对外入口。路由与页面只从这里 import，
 * 内部按职责拆成 config / repository / generation / model-call / limits / share。
 */
export {MirrorError} from './errors';
export {readConfigFor, readMirrorRules, toRulesView, type MirrorConfig, type MirrorRulesView} from './config';
export {
  COOKIE_MAX_AGE,
  generateMirror,
  identityOf,
  listMirrorCharacters,
  newMirrorShareId,
  quotaOf,
  readMirrorContext,
  recordMirrorCall,
  type MirrorContext,
  type MirrorCookieWrite,
  type MirrorGenerationResult,
  type MirrorRequestStateLike,
} from './service';
export {compareMirrorResults, deleteMirrorResult, expireMirrorResults, readMirrorResult, readMyMirrorResults, type MirrorOwnerView, type MirrorReadResult} from './repository';
export {MirrorModelError} from './model-call';
export {mirrorDayKey, readMirrorUsage, type MirrorIdentity} from './limits';
export {mirrorAttributionCookieName, newMirrorSubject, readCookie, signMirrorAttribution, verifyMirrorAttribution} from './share';
export type {
  MirrorCharacterOption,
  MirrorIndices,
  MirrorOverLimitPolicy,
  MirrorOwnerResult,
  MirrorPublicResult,
  MirrorQuota,
  MirrorResultFields,
  MirrorRules,
} from './types';
export {MIRROR_QUOTA_COOKIE, MIRROR_SETTINGS, MIRROR_SUBJECT_COOKIE} from './types';