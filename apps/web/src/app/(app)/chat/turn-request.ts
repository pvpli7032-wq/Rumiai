import type {CostNotice, CostReceipt} from '@web/lib/hooks/use-quota';

/**
 * 一次点击 = 一个请求号（V3 §20）。
 *
 * 断线或超时之后绝不能换个编号重发：换号等于换了一笔费用单，用户可能被收两次。
 * 这里只做三件事——发号、读流、按号查结果；重发与否由页面决定，且必须沿用同一编号。
 */

/** 新的一次点击：生成编号。UUID 一定满足服务端 /^[A-Za-z0-9_-]{8,64}$/。 */
export function newRequestId(): string {
  return crypto.randomUUID();
}

/** 断线查询的返回体，与 GET /api/conversations/[id]/turns 一致。 */
export interface TurnState {
  requestId: string;
  chargeStatus: string | null;
  coins: number;
  allowanceSource: string;
  messageId: string | null;
  status: 'DONE' | 'PENDING' | 'FAILED' | 'NONE';
}

/**
 * 按请求号查这次点击的结果。网络错误按「查不到」处理——查不到不等于失败，
 * 所以调用方只允许用户手动重试，不做自动重发。
 */
export async function queryTurn(token: string, conversationId: string, requestId: string): Promise<TurnState | null> {
  try {
    const res = await fetch(`/api/conversations/${conversationId}/turns?requestId=${encodeURIComponent(requestId)}`, {headers: {Authorization: `Bearer ${token}`}, cache: 'no-store'});
    return res.ok ? await res.json() as TurnState : null;
  } catch {
    return null;
  }
}

export interface StreamHandlers {
  onText: (text: string) => void;
  onCost: (event: {cost?: CostNotice; costResult?: CostReceipt}) => void;
  onMock: () => void;
}

/**
 * 读聊天 SSE。发送与重生成共用同一条线格式：内容片段、错误、计费事件、[DONE]。
 * 必须按流解码并保留半行缓冲，否则一个多字节字符被切在两个分片里就会变成乱码。
 */
export async function consumeChatStream(res: Response, handlers: StreamHandlers): Promise<string> {
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    // 402 余额不足要单独处理：保留草稿、给充值入口，不当成普通发送失败。
    const failure = new Error(data.error || `请求失败 (${res.status})`) as Error & {code?: string; status: number};
    failure.code = typeof data.code === 'string' ? data.code : undefined;
    failure.status = res.status;
    throw failure;
  }
  if (!res.body) throw new Error('服务器没有返回聊天数据。');
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let full = '';
  let finished = false;
  try {
    while (!finished) {
      const {done, value} = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, {stream: true});
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') { finished = true; break; }
        let event: {content?: string; error?: string; demo?: boolean; cost?: CostNotice; costResult?: CostReceipt};
        try { event = JSON.parse(data); } catch { continue; }
        if (event.error) throw new Error(event.error);
        // 计费事件就地更新余额与免费剩余，不整页刷新（V3 表 15）。
        if (event.cost || event.costResult) { handlers.onCost(event); continue; }
        if (event.demo) handlers.onMock();
        full += event.content || '';
        handlers.onText(full);
      }
    }
    if (!finished) throw new Error('连接中断，回复尚未确认保存，请重试。');
    return full;
  } finally {
    await reader.cancel().catch(() => {});
  }
}
