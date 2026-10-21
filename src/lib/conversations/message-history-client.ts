import type {ChatMessage} from '@/lib/api-types/conversations';

/**
 * 会话历史的分页读取（客户端）。
 *
 * 规划书 §21 的口径：分页是显式选择——不传 limit 的老调用方继续拿完整数组，
 * 传了才拿到 {messages, hasMore, nextCursor}。聊天页从这里统一走分页，
 * 避免 1 万条历史把整个响应体一次拉回来。
 */
export type MessagePage = {
  messages: ChatMessage[];
  hasMore: boolean;
  nextCursor: string | null;
};

export const LATEST_PAGE_SIZE = 50;
/** 服务端上限；超过这个数的"回读更多"没有意义，只会把响应体又拉大。 */
export const MAX_PAGE_SIZE = 200;

function pageUrl(conversationId: string, limit: number, before?: string | null) {
  const query = new URLSearchParams({limit: String(limit)});
  if (before) query.set('before', before);
  return `/api/conversations/${encodeURIComponent(conversationId)}/messages?${query.toString()}`;
}

async function readPage(response: Response): Promise<MessagePage | null> {
  if (!response.ok) return null;
  const data = await response.json().catch(() => null);
  if (!data || !Array.isArray(data.messages)) return null;
  return {
    messages: data.messages,
    hasMore: Boolean(data.hasMore),
    nextCursor: typeof data.nextCursor === 'string' ? data.nextCursor : null,
  };
}

/** 最新一页（会话尾部）。首屏与"重新对齐"都走它。 */
export async function fetchLatestMessagePage(
  token: string, conversationId: string, limit = LATEST_PAGE_SIZE, signal?: AbortSignal,
): Promise<MessagePage | null> {
  const response = await fetch(pageUrl(conversationId, Math.min(limit, MAX_PAGE_SIZE)), {
    headers: {Authorization: `Bearer ${token}`}, signal,
  }).catch(() => null);
  return response ? readPage(response) : null;
}

/** 往前翻一页；cursor 是本页最早一条的游标。 */
export async function fetchEarlierMessagePage(
  token: string, conversationId: string, cursor: string, limit = LATEST_PAGE_SIZE, signal?: AbortSignal,
): Promise<MessagePage | null> {
  const response = await fetch(pageUrl(conversationId, Math.min(limit, MAX_PAGE_SIZE), cursor), {
    headers: {Authorization: `Bearer ${token}`}, signal,
  }).catch(() => null);
  return response ? readPage(response) : null;
}

/**
 * 重新对齐时要取多少条：至少一页，最多服务端上限。
 * 已经翻出更早内容时按当前条数取，避免用户点完"加载更早"再发一条消息就把上面折叠回去。
 */
export function refetchPageSize(loadedCount: number): number {
  return Math.min(Math.max(loadedCount + 2, LATEST_PAGE_SIZE), MAX_PAGE_SIZE);
}
