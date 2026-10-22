import type {AiStreamMetrics} from './types';

/**
 * 把上游 SSE 收成一整段文本（不向客户端开流）。
 *
 * Mirror 生成与故事状态抽取都要「先拿完整文本再处理」，此前各写了一份逐行解析；
 * 两处的数据格式、[DONE] 处理与半行缓冲规则完全相同，所以只留这里一份。
 * 传入 metrics 时顺带回填 usage，供应商没有 usage 字段就保持原值。
 */
export async function collectStreamText(
  response: Response & {body: ReadableStream<Uint8Array>},
  metrics?: AiStreamMetrics,
): Promise<string> {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let buffer = '';
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, {stream: true});
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data) as {choices?: Array<{delta?: {content?: unknown}}>; usage?: {prompt_tokens?: number; completion_tokens?: number}};
          const content = parsed.choices?.[0]?.delta?.content;
          if (typeof content === 'string') text += content;
          if (metrics && Number.isInteger(parsed.usage?.prompt_tokens)) metrics.inputTokens = parsed.usage!.prompt_tokens;
          if (metrics && Number.isInteger(parsed.usage?.completion_tokens)) metrics.outputTokens = parsed.usage!.completion_tokens;
        } catch { /* keep-alive 或半行，忽略 */ }
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return text;
}
