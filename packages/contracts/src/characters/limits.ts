import type {PublicSettingKey} from '@rumiai/contracts/settings/public-keys';

/**
 * 角色字段的上限与字段清单。
 *
 * 运营项（名称/简介/人设/背景/开场白的字数）由设置中心决定，服务端校验与前台输入框
 * 共用 buildCharacterLimits 这一份换算；纯技术上限（字段宽度、地址长度）固定在这里。
 * 本文件不 import 数据库，客户端组件可以直接引用。
 */
export const CHARACTER_TECHNICAL_LIMITS = {roleTemplate: 1000, tags: 512, badges: 128, avatarUrl: 2048, copyrightStatement: 1000} as const;

/** 允许出现在角色内容里的字段名。字段集合与上限分开：上限会变，字段名不会。 */
export const CHARACTER_FIELDS = ['name', 'tagline', 'personality', 'background', 'greeting', 'scenario', 'roleTemplate', 'tags', 'badges', 'avatarUrl', 'copyrightStatement'] as const;

export const CHARACTER_LABELS: Record<string, string> = {name: '角色名称', tagline: '简介', personality: '人设', background: '背景', greeting: '开场白', scenario: '场景', roleTemplate: '扮演指引', tags: '标签', badges: '徽章', avatarUrl: '头像地址', copyrightStatement: '版权声明'};

export type CharacterLimits = Record<(typeof CHARACTER_FIELDS)[number], number>;

/** 用给定的取值函数拼出完整上限表：服务端传设置读取，前台传 ui-config 读取。 */
export function buildCharacterLimits(read: (key: PublicSettingKey) => number): CharacterLimits {
  const opening = read('content.character.openingMax');
  return {
    name: read('content.character.nameMax'),
    tagline: read('content.character.summaryMax'),
    personality: read('content.character.personaMax'),
    background: read('content.character.backgroundMax'),
    greeting: opening,
    // 开场白与场景描述共用一项设置（registry 说明里已写明）。
    scenario: opening,
    ...CHARACTER_TECHNICAL_LIMITS,
  };
}

export type CharacterCreationQuota = {
  used: number; publicLimit: number | null; membershipLimit: number | null;
  effectiveLimit: number | null; remaining: number | null;
  source: 'PUBLIC_UNLIMITED' | 'MEMBERSHIP' | 'PUBLIC'; membershipOrderNo: string | null;
};
