/**
 * Moderation report types offered by the product's report dialog.
 * Keep presentation labels in translations; this file defines accepted API values.
 */
export const REPORT_CATEGORIES = [
  'sexualContent', 'violence', 'hateSpeech', 'underageContent', 'animalAbuse', 'inappropriateImage',
  'copyright', 'impersonation', 'spam', 'abuse', 'inappropriateContent', 'availableOnOtherPlatform', 'other',
] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

export const IMAGE_REASONS = ['realPerson', 'explicit', 'violent', 'other'] as const;
export const REPORT_TARGET_TYPES = ['CHARACTER', 'USER', 'COMMENT', 'POST', 'POST_COMMENT', 'UNIVERSE', 'MESSAGE'] as const;
export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];
export const COPYRIGHT_RELATIONSHIPS = ['owner', 'licensee', 'witness'] as const;
export const CONTACT_TYPES = ['email', 'discord'] as const;
export const MAX_DETAILS = 4_000;

export function isReportCategory(value: unknown): value is ReportCategory {
  return typeof value === 'string' && (REPORT_CATEGORIES as readonly string[]).includes(value);
}

export function isReportTargetType(value: unknown): value is ReportTargetType {
  return typeof value === 'string' && (REPORT_TARGET_TYPES as readonly string[]).includes(value);
}
