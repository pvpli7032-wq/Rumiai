/** Shared avatar URL syntax validation for account and character records. */
export const AVATAR_URL_MAX_LENGTH = 2048;

export function validateAvatarUrl(value: unknown): string | null {
  if (typeof value !== 'string') return '头像地址必须为文本。';
  if (value.length > AVATAR_URL_MAX_LENGTH) return `头像地址不能超过 ${AVATAR_URL_MAX_LENGTH} 字。`;
  const text = value.trim();
  if (!text) return null;
  let valid = /^\/(?:uploads|brand)\/[a-zA-Z0-9_./-]+$/.test(text) && !text.includes('..');
  try { valid ||= ['http:', 'https:'].includes(new URL(text).protocol); } catch {}
  return valid ? null : '头像地址须为 HTTP/HTTPS 图片地址或本地上传素材。';
}
