/**
 * A one-line signal that the chat list changed.
 *
 * The sidebar refetches on route change, but a conversation is created *after* the chat
 * page mounts — so arriving at a brand new chat left the sidebar reading "暂无聊天"
 * while the reader was already talking to someone. An event keeps the two components from
 * having to know about each other.
 */
export const CHAT_LIST_CHANGED = 'xingban:chat-list-changed';

export function notifyChatListChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHAT_LIST_CHANGED));
}
