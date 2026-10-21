import type {MirrorCharacterOption, MirrorOwnerResult, MirrorPublicResult, MirrorQuota} from '@/lib/mirror/types';

export type MirrorRulesView = import('@/lib/mirror/types').MirrorRules & {enabled: boolean; timezone: string};

/** 首页初始化接口的返回；与服务端 readPageView 的字段一一对应。 */
export type MirrorPageResponse = {
  characters: MirrorCharacterOption[];
  rules: MirrorRulesView;
  quota: MirrorQuota;
  mine: {shareId: string; title: string; characterName: string; characterAvatarUrl: string | null; createdAt: string}[];
};

export type MirrorGenerateResponse = {result: MirrorOwnerResult; quota: MirrorQuota};

export type MirrorView = {kind: 'public'; result: MirrorPublicResult} | {kind: 'owner'; result: MirrorOwnerResult};