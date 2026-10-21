import {existsSync} from 'node:fs';
import path from 'node:path';
import {checkRateLimit} from '@/lib/rate-limit';
import {readCommunityRules} from '@/lib/settings';
import {mayAttachAccountUpload, type UploadReader} from '@/lib/uploads/read-service';
import {uploadDirectory} from '@/lib/uploads/storage-service';
import {PostManagementError} from './errors';

/**
 * 帖子与评论的校验。
 *
 * 字数、图片张数与频率窗口都是运营参数（content.post.* / content.comment.* / limits.*），
 * 每次提交现读设置中心，不在模块顶层求值成常量（V3 表 10）。
 */
const UPLOAD_URL = /^\/uploads\/[A-Za-z0-9_-]{1,160}\.(?:jpg|png|webp)$/;

export async function validatePostContent(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) throw new PostManagementError('帖子内容不能为空。');
  const {postMaxChars} = await readCommunityRules();
  if (value.trim().length > postMaxChars) throw new PostManagementError(`帖子内容不能超过 ${postMaxChars} 字符。`);
  return value.trim();
}

export async function validatePostComment(value: unknown, imageUrl: unknown) {
  const content = typeof value === 'string' ? value.trim() : '';
  if (!content && (imageUrl === undefined || imageUrl === null || imageUrl === '')) throw new PostManagementError('请填写评论或添加图片。');
  const {commentMaxChars} = await readCommunityRules();
  if (content.length > commentMaxChars) throw new PostManagementError(`评论不能超过 ${commentMaxChars} 字符。`);
  if (imageUrl !== undefined && imageUrl !== null && imageUrl !== '' && (typeof imageUrl !== 'string' || !UPLOAD_URL.test(imageUrl))) throw new PostManagementError('图片仅支持站内 JPG、PNG 或 WebP 上传。');
  return {content, imageUrl: typeof imageUrl === 'string' && imageUrl ? imageUrl : null};
}

export async function validatePostImages(value: unknown, userId: string, reader?: UploadReader) {
  if (value === undefined) return [] as string[];
  const {postMaxImages} = await readCommunityRules();
  if (!Array.isArray(value) || value.length > postMaxImages || value.some(url => typeof url !== 'string' || !UPLOAD_URL.test(url))) throw new PostManagementError(`图片仅支持站内 JPG、PNG、WebP 上传，最多 ${postMaxImages} 张。`);
  if (new Set(value).size !== value.length) throw new PostManagementError('不能重复添加同一张图片。');
  const urls = value as string[];
  if (urls.some(url => !existsSync(path.join(uploadDirectory(), url.slice('/uploads/'.length))))) throw new PostManagementError('图片上传文件不存在，请重新上传。');
  if ((await Promise.all(urls.map(url => mayAttachAccountUpload(userId, url, {reader})))).some(allowed => !allowed)) throw new PostManagementError('只能使用自己上传的图片。');
  return urls;
}

export async function claimPostRateLimit(userId: string, kind: 'post' | 'comment') {
  const rules = await readCommunityRules();
  const limit = kind === 'post' ? rules.postPerWindow : rules.commentPerWindow;
  const windowMs = kind === 'post' ? rules.postWindowMs : rules.commentWindowMs;
  const result = checkRateLimit(`community:${kind}:${userId}`, limit, windowMs);
  if (!result.allowed) throw new PostManagementError('操作太频繁，请稍后重试。', 429, result.retryAfter);
}
