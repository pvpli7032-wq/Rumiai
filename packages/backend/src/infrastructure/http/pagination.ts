/**
 * 游标分页的编码。
 *
 * 各域的位置对象不同（聊天是 createdAt+id，故事目录是另一组字段），解码时的校验与
 * 错误类型也不同，所以只共享编码这一步——同一段 base64url 逻辑此前在
 * conversations/message-service 与 stories/catalog-service 各写了一份。
 */
export function encodeCursor(cursor: object): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}
