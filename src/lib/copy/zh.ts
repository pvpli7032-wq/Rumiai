/**
 * Chinese copy that is derived rather than written at the call site.
 *
 * Screen wording lives inline where it renders: the app ships one language, so a
 * lookup table between keys and sentences would only add a hop between the source
 * and what the reader sees. This module keeps the one piece of copy that cannot
 * live inline — the wording for messages produced by the API layer, keyed by the
 * message the API returns.
 */

/** Server and API messages that can reach the UI, keyed by the message the API returns. */
export const errorCopy: Record<string, string> = {
  Unauthorized: '请先登录',
  Forbidden: '没有访问权限',
  'Invalid credentials': '邮箱或密码不正确',
  'Email already in use': '邮箱已被注册',
  'Email or username already in use': '邮箱或用户名已被使用',
  'Username already in use': '用户名已被使用',
  'Network error': '网络连接失败，请重试',
  'Internal server error': '服务暂时不可用，请稍后重试',
  'Already checked in today': '今天已经签到',
  'Insufficient coins': '测试金币不足',
  'Password is too long': '密码过长',
  'Missing required fields': '请填写必填项',
};

/**
 * Map an API message to what the reader sees. Chinese messages pass through
 * unchanged; anything else becomes a generic failure line so an English or Thai
 * message never surfaces raw.
 */
export function zhError(text: string): string {
  if (!text) return '';
  return errorCopy[text] ?? (/[\u4e00-\u9fff]/.test(text) ? text : '操作失败，请稍后重试。');
}
