/**
 * Moderation reports.
 *
 * The categories are the ones the live site offers, taken from its own translation
 * dictionary rather than invented here, so a report filed through this API means the
 * same thing as one filed on khuiai.com.
 */

export const REPORT_CATEGORIES = [
  'sexualContent',
  'violence',
  'hateSpeech',
  'underageContent',
  'animalAbuse',
  'inappropriateImage',
  'copyright',
  'impersonation',
  'spam',
  'abuse',
  'inappropriateContent',
  'availableOnOtherPlatform',
  'other',
] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

/** Narrows an inappropriateImage report. */
export const IMAGE_REASONS = ['realPerson', 'explicit', 'violent', 'other'] as const;

export const REPORT_TARGET_TYPES = ['CHARACTER', 'USER', 'COMMENT', 'POST', 'POST_COMMENT', 'UNIVERSE', 'MESSAGE'] as const;
export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];

export const REPORT_STATUSES = ['OPEN', 'REVIEWING', 'ACTIONED', 'DISMISSED'] as const;

/** Copyright claims are the only category that asks who is claiming and on what basis. */
export const COPYRIGHT_RELATIONSHIPS = ['owner', 'licensee', 'witness'] as const;
export const CONTACT_TYPES = ['email', 'discord'] as const;

export const MAX_DETAILS = 4_000;

export function isReportCategory(value: unknown): value is ReportCategory {
  return typeof value === 'string' && (REPORT_CATEGORIES as readonly string[]).includes(value);
}

export function isReportTargetType(value: unknown): value is ReportTargetType {
  return typeof value === 'string' && (REPORT_TARGET_TYPES as readonly string[]).includes(value);
}

/**
 * Reports are how a platform hears about illegal content, so filing one must not be
 * gated behind anything — but it also must not be an amplifier. One report per person
 * per target is enough; a second is an update, not a second complaint.
 */
export const REPORT_RATE_LIMIT = Number(process.env.REPORT_RATE_LIMIT) || 20;
export const REPORT_RATE_WINDOW_MS = Number(process.env.REPORT_RATE_WINDOW_MS) || 3_600_000;
