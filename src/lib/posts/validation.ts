import {existsSync} from 'node:fs';
import path from 'node:path';
import {checkRateLimit} from '@/lib/rate-limit';
import {mayAttachAccountUpload, type UploadReader} from '@/lib/uploads/read-service';
import {uploadDirectory} from '@/lib/uploads/storage-service';
import {PostManagementError} from './errors';

export const POST_MAX_CHARS = 5_000;
export const POST_COMMENT_MAX_CHARS = 2_000;
export const POST_MAX_IMAGES = 4;
const UPLOAD_URL = /^\/uploads\/[A-Za-z0-9_-]{1,160}\.(?:jpg|png|webp)$/;
export function validatePostContent(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) throw new PostManagementError('帖子内容不能为空。');
  if (value.trim().length > POST_MAX_CHARS) throw new PostManagementError(`帖子内容不能超过 ${POST_MAX_CHARS} 字符。`);
  return value.trim();
}
export function validatePostComment(value: unknown, imageUrl: unknown) {
  const content = typeof value === 'string' ? value.trim() : '';
  if (!content && (imageUrl === undefined || imageUrl === null || imageUrl === '')) throw new PostManagementError('请填写评论或添加图片。');
  if (content.length > POST_COMMENT_MAX_CHARS) throw new PostManagementError(`评论不能超过 ${POST_COMMENT_MAX_CHARS} 字符。`);
  if (imageUrl !== undefined && imageUrl !== null && imageUrl !== '' && (typeof imageUrl !== 'string' || !UPLOAD_URL.test(imageUrl))) throw new PostManagementError('图片仅支持站内 JPG、PNG 或 WebP 上传。');
  return {content, imageUrl: typeof imageUrl === 'string' && imageUrl ? imageUrl : null};
}
export async function validatePostImages(value: unknown, userId: string, reader?: UploadReader) {
  if (value === undefined) return [] as string[];
  if (!Array.isArray(value) || value.length > POST_MAX_IMAGES || value.some(url => typeof url !== 'string' || !UPLOAD_URL.test(url))) throw new PostManagementError(`图片仅支持站内 JPG、PNG、WebP 上传，最多 ${POST_MAX_IMAGES} 张。`);
  if (new Set(value).size !== value.length) throw new PostManagementError('不能重复添加同一张图片。');
  const urls = value as string[];
  if (urls.some(url => !existsSync(path.join(uploadDirectory(), url.slice('/uploads/'.length))))) throw new PostManagementError('图片上传文件不存在，请重新上传。');
  if ((await Promise.all(urls.map(url => mayAttachAccountUpload(userId, url, {reader})))).some(allowed => !allowed)) throw new PostManagementError('只能使用自己上传的图片。');
  return urls;
}
export function claimPostRateLimit(userId: string, kind: 'post' | 'comment') {
  const result = checkRateLimit(`community:${kind}:${userId}`, kind === 'post' ? 10 : 20, 600_000);
  if (!result.allowed) throw new PostManagementError('操作太频繁，请稍后重试。', 429, result.retryAfter);
}
