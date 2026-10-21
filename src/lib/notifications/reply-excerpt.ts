/** 回复提醒正文的压缩规则。纯函数：服务端写通知与客户端渲染共用一份。 */
const REPLY_EXCERPT_MAX = 80;

/** 回复提醒的正文：去掉换行、过长截断，抽屉里只占两行。 */
export function replyExcerpt(text: string, max = REPLY_EXCERPT_MAX): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? flat.slice(0, max) + '…' : flat;
}
