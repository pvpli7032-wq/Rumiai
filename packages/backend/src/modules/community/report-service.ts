import { db } from '@rumiai/backend/infrastructure/database/client';
import { checkRateLimit } from '@rumiai/backend/infrastructure/http/rate-limit';
import { readRateLimitRules } from '@rumiai/backend/modules/settings/limits';
import {
  CONTACT_TYPES, COPYRIGHT_RELATIONSHIPS, IMAGE_REASONS, MAX_DETAILS, REPORT_CATEGORIES,
  REPORT_TARGET_TYPES, isReportCategory, isReportTargetType,
} from '@rumiai/contracts/community/report-types';

const oneOf = (list: readonly string[], value: unknown) => typeof value === 'string' && list.includes(value) ? value : undefined;

export class CommunityReportError extends Error {
  constructor(message: string, readonly status: number, readonly retryAfter?: number) {
    super(message);
    this.name = 'CommunityReportError';
  }
}

export async function listOwnReports(reporterId: string) {
  return db.report.findMany({
    where: { reporterId },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: {
      id: true, targetType: true, targetId: true, category: true, imageReason: true, details: true,
      evidenceContent: true, workTitle: true, relationship: true, sourceLink: true, status: true, createdAt: true,
    },
  });
}

export async function submitReport(reporterId: string, input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CommunityReportError('举报数据格式不正确。', 400);
  const body = input as Record<string, unknown>;
  const targetType = (body.targetType ?? body.target_type ?? '').toString().toUpperCase();
  const rawTargetId = body.targetId ?? body.target_id;
  const targetId = typeof rawTargetId === 'string' ? rawTargetId.trim() : '';
  const category = body.category;
  const details = typeof body.details === 'string' ? body.details.trim() : '';

  if (!isReportTargetType(targetType)) throw new CommunityReportError(`targetType must be one of ${REPORT_TARGET_TYPES.join(', ')}`, 400);
  if (!targetId) throw new CommunityReportError('targetId is required', 400);
  if (!isReportCategory(category)) throw new CommunityReportError(`category must be one of ${REPORT_CATEGORIES.join(', ')}`, 400);
  if (category === 'other' && !details) throw new CommunityReportError('details is required for the "other" category', 400);
  if (details.length > MAX_DETAILS) throw new CommunityReportError(`details must be ${MAX_DETAILS} characters or fewer`, 400);

  let evidenceContent: string | null = null;
  if (targetType === 'CHARACTER') {
    const exists = await db.character.findUnique({ where: { id: targetId }, select: { id: true } });
    if (!exists) throw new CommunityReportError('Character not found', 404);
  } else if (targetType === 'MESSAGE') {
    const message = await db.message.findUnique({ where: { id: targetId }, select: { content: true, role: true, conversation: { select: { userId: true } } } });
    if (!message) throw new CommunityReportError('消息不存在。', 404);
    if (message.conversation.userId !== reporterId) throw new CommunityReportError('只能举报自己对话中的 AI 回复。', 403);
    if (message.role !== 'ASSISTANT') throw new CommunityReportError('此入口用于举报 AI 回复。', 400);
    evidenceContent = message.content;
  } else if (targetType === 'USER') {
    const exists = await db.user.findUnique({ where: { id: targetId }, select: { id: true } });
    if (!exists) throw new CommunityReportError('User not found', 404);
  } else if (targetType === 'POST') {
    const post = await db.post.findUnique({ where: { id: targetId }, select: { content: true, media: { orderBy: { position: 'asc' }, select: { url: true } } } });
    if (!post) throw new CommunityReportError('帖子不存在。', 404);
    evidenceContent = post.content + (post.media.length ? '\n\n图片：\n' + post.media.map(image => image.url).join('\n') : '');
  } else if (targetType === 'POST_COMMENT') {
    const comment = await db.postComment.findUnique({ where: { id: targetId }, select: { content: true, imageUrl: true } });
    if (!comment) throw new CommunityReportError('评论不存在。', 404);
    evidenceContent = comment.content + (comment.imageUrl ? '\n\n图片：\n' + comment.imageUrl : '');
  } else if (targetType === 'COMMENT') {
    const comment = await db.comment.findUnique({ where: { id: targetId }, select: { body: true } });
    if (!comment) throw new CommunityReportError('评论不存在。', 404);
    evidenceContent = comment.body;
  }

  const rules = await readRateLimitRules();
  const limit = checkRateLimit(`report:${reporterId}`, rules.report.perWindow, rules.report.windowMs);
  if (!limit.allowed) throw new CommunityReportError('提交举报过于频繁，请稍后重试。', 429, limit.retryAfter);

  const data = {
    reporterId, targetType, targetId, category, details, evidenceContent,
    imageReason: category === 'inappropriateImage' ? oneOf(IMAGE_REASONS, body.imageReason ?? body.image_reason) ?? null : null,
    workTitle: category === 'copyright' ? typeof (body.workTitle ?? body.work_title) === 'string' ? String(body.workTitle ?? body.work_title).trim() : null : null,
    relationship: category === 'copyright' ? oneOf(COPYRIGHT_RELATIONSHIPS, body.relationship) ?? null : null,
    sourceLink: category === 'copyright' ? typeof (body.sourceLink ?? body.source_link) === 'string' ? String(body.sourceLink ?? body.source_link).trim() : null : null,
    contactType: oneOf(CONTACT_TYPES, body.contactType ?? body.contact_type) ?? null,
    contactValue: typeof (body.contactValue ?? body.contact_value) === 'string' ? String(body.contactValue ?? body.contact_value).trim() : null,
  };

  const result = await db.$transaction(async tx => {
    const existing = await tx.report.findFirst({ where: { reporterId, targetType, targetId }, select: { id: true } });
    const report = existing
      ? await tx.report.update({ where: { id: existing.id }, data: { ...data, status: 'OPEN' }, select: { id: true, status: true, createdAt: true } })
      : await tx.report.create({ data, select: { id: true, status: true, createdAt: true } });
    return { report, updated: Boolean(existing) };
  });
  return { success: true, ...result };
}
