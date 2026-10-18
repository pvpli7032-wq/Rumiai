import { REPORT_CATEGORIES, IMAGE_REASONS, COPYRIGHT_RELATIONSHIPS } from '@/lib/community/report-types';

/**
 * Chinese labels for the report taxonomy. The keys come from src/lib/community/report-types.ts,
 * so this file only supplies the wording — never the set.
 */
export const CATEGORY_LABELS: Record<(typeof REPORT_CATEGORIES)[number], string> = {
  sexualContent: "色情内容",
  violence: "暴力内容",
  hateSpeech: "仇恨言论",
  underageContent: "涉及未成年人的内容",
  animalAbuse: "虐待动物",
  inappropriateImage: "不当图片",
  copyright: "侵犯版权",
  impersonation: "冒充他人",
  spam: "垃圾信息",
  abuse: "骚扰或欺凌",
  inappropriateContent: "不当内容",
  availableOnOtherPlatform: "在其他平台发布",
  other: "其他",
};

export const IMAGE_REASON_LABELS: Record<(typeof IMAGE_REASONS)[number], string> = {
  realPerson: "真实人物照片",
  explicit: "裸露图片",
  violent: "暴力图片",
  other: "其他",
};

export const RELATIONSHIP_LABELS: Record<(typeof COPYRIGHT_RELATIONSHIPS)[number], string> = {
  owner: "我是版权持有人",
  licensee: "我是被授权使用者",
  witness: "我是发现问题的人",
};
