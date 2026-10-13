import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { checkRateLimit } from '@/lib/rate-limit';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { mayAttachAccountUpload } from '@/lib/uploads/read-service';
import { uploadDirectory } from '@/lib/uploads/storage-service';

export const POST_MAX_CHARS = 5_000;
export const POST_COMMENT_MAX_CHARS = 2_000;
export const POST_MAX_IMAGES = 4;
const UPLOAD_URL = /^\/uploads\/[A-Za-z0-9_-]{1,160}\.(?:jpg|png|webp)$/;

export function parseCommunityBody(request: Request, maxBytes = 40_000) {
  const size = Number(request.headers.get('content-length') || 0);
  if (size > maxBytes) return { response: NextResponse.json({ error: '内容过大。' }, { status: 413 }) };
  return null;
}

export function validatePostContent(body: unknown) {
  if (typeof body !== 'string' || !body.trim()) return { error: '帖子内容不能为空。' };
  if (body.trim().length > POST_MAX_CHARS) return { error: `帖子内容不能超过 ${POST_MAX_CHARS} 字符。` };
  return { content: body.trim() };
}

export async function validatePostImages(value: unknown, userId: string) {
  if (value === undefined) return { urls: [] as string[] };
  if (!Array.isArray(value) || value.length > POST_MAX_IMAGES || value.some(url => typeof url !== 'string' || !UPLOAD_URL.test(url))) {
    return { error: `图片仅支持站内 JPG、PNG、WebP 上传，最多 ${POST_MAX_IMAGES} 张。` };
  }
  if (new Set(value).size !== value.length) return { error: '不能重复添加同一张图片。' };
  if ((value as string[]).some(url => !existsSync(path.join(uploadDirectory(), url.slice('/uploads/'.length))))) return { error: '图片上传文件不存在，请重新上传。' };
  if ((await Promise.all((value as string[]).map(url => mayAttachAccountUpload(userId, url)))).some(allowed => !allowed)) return { error: '只能使用自己上传的图片。' };
  return { urls: value as string[] };
}

export async function hasCircleMembership(circleId: string, userId: string) {
  return Boolean(await db.circleMember.findFirst({ where: { circleId, userId, circle: { status: 'ACTIVE' } }, select: { userId: true } }));
}

export function postRateLimit(userId: string, kind: 'post' | 'comment') {
  const result = checkRateLimit(`community:${kind}:${userId}`, kind === 'post' ? 10 : 20, 600_000);
  return result.allowed ? null : NextResponse.json({ error: '操作太频繁，请稍后重试。' }, { status: 429, headers: { 'Retry-After': String(result.retryAfter) } });
}
