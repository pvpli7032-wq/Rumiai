import { buildCharacterLimits, CHARACTER_TECHNICAL_LIMITS } from '@rumiai/contracts/characters/limits';
import { Eye, MessageSquareQuote, Sparkles, Tags, UserRound } from 'lucide-react';

export const DRAFT_KEY = 'xingban:character-draft';
/** 改名前的键，第一次读取时迁移过来再删掉。 */
const LEGACY_DRAFT_KEY = 'khuiai:character-draft';

/**
 * 字数上限由设置中心统一管理（content.character.*），前端从 /api/ui-config 取同一份值，
 * 与服务端校验共用 buildCharacterLimits。未加载时给 0：maxLength={0} 在浏览器里等于不限，
 * 服务端仍按真实配置校验，不会因为前端还没拿到配置就把用户输入截断。
 */
export function limitsFromConfig(config: Record<string, unknown>) {
  const base = buildCharacterLimits(key => {
    const value = config[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  });
  return { ...base, description: base.personality, bio: base.background, roleTemplate: CHARACTER_TECHNICAL_LIMITS.roleTemplate };
}

export const SECTIONS = [
  { id: 'identity', label: "身份", desc: "名称、简介和头像", icon: UserRound },
  { id: 'persona', label: "个性", desc: "性格与背景", icon: Sparkles },
  { id: 'opening', label: "开场", desc: "第一句话", icon: MessageSquareQuote },
  { id: 'tags', label: "标签", desc: "方便其他人发现", icon: Tags },
  { id: 'publish', label: "发布", desc: "公开或私密", icon: Eye },
] as const;

export interface Draft {
  name: string; tagline: string; description: string; bio: string; greeting: string;
  avatarUrl: string; tags: string[]; badges: string[]; isExclusive: boolean; isPublic: boolean;
  /** Both reach the model's system prompt; neither was collectable before. */
  scenario: string; roleTemplate: string;
  /** Unlocks the adult direction in the system prompt. */
  isAdult: boolean; copyrightStatement: string;
}

/** 把改名前的草稿搬到新键上，只搬一次。 */
export function migrateLegacyDraft(draftKey: string): string | null {
  const legacy = localStorage.getItem(LEGACY_DRAFT_KEY);
  if (!legacy) return null;
  localStorage.setItem(draftKey, legacy);
  localStorage.removeItem(LEGACY_DRAFT_KEY);
  return legacy;
}

export const EMPTY: Draft = {
  name: '', tagline: '', description: '', bio: '', greeting: '',
  avatarUrl: '', tags: [], badges: [], isExclusive: false, isPublic: true,
  scenario: '', roleTemplate: '', isAdult: false, copyrightStatement: '',
};

export const INPUT_CLS =
  'w-full rounded-xl border border-input bg-transparent px-3.5 py-2.5 text-base shadow-xs transition-colors placeholder:text-muted-foreground/70 focus-visible:border-brand-strong focus-visible:outline-hidden';
