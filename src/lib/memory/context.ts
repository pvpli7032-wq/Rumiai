import {readInjectableFacts} from './fact-service';
import {readMemorySettings, readMemorySummary} from './summary-service';
import {EMPTY_MEMORY_CONTEXT, type MemoryContext} from './types';

/**
 * 把记忆拼成一段可注入的上下文（V3 第 25 章）。
 *
 * 三条边界：
 * - 关闭 memory.enabled 后既不生成也不注入，直接返回空上下文。
 * - 只注入 ACTIVE 事实；来源消息被删除或编辑的事实已置 INVALID，不会出现在这里。
 * - 总预算按 memory.contextBudgetTokens 控制：中文约 1 字 1 token，超预算时先砍事实再砍摘要，
 *   不因为记忆把角色设定和近期消息挤出上下文。
 */

/** 中文按字近似 token；只用于预算裁剪，不参与计费。 */
function approximateTokens(text: string): number {
  return text.length;
}

function renderFacts(facts: Array<{text: string; pinned: boolean}>): string {
  const pinned = facts.filter(fact => fact.pinned).map(fact => '- ' + fact.text);
  const rest = facts.filter(fact => !fact.pinned).map(fact => '- ' + fact.text);
  const lines = [...pinned, ...rest];
  return lines.length ? '已经确认的事实：\n' + lines.join('\n') : '';
}

function renderSummary(summary: string): string {
  return summary ? '之前聊过的事（摘要）：\n' + summary : '';
}

/**
 * 读取并裁剪本次请求要注入的记忆。
 *
 * `reservedTokens` 是角色设定与近期消息已经占掉的预算，由调用方传入；
 * 剩余预算为 0 时不注入，避免把上下文挤爆。
 */
export async function buildMemoryContext(conversationId: string, options: {userId?: string | null; reservedTokens?: number} = {}): Promise<MemoryContext> {
  const settings = await readMemorySettings(options.userId ?? null);
  if (!settings.enabled) return EMPTY_MEMORY_CONTEXT;

  const [summaryRow, facts] = await Promise.all([
    readMemorySummary(conversationId),
    readInjectableFacts(conversationId, settings.maxFacts),
  ]);
  if (!summaryRow && facts.length === 0) return EMPTY_MEMORY_CONTEXT;

  let remaining = settings.contextBudgetTokens - (options.reservedTokens ?? 0);
  if (remaining <= 0) return EMPTY_MEMORY_CONTEXT;

  // 摘要先占预算（它决定人物关系与约定），剩下的给事实；再超就把事实从后往前砍。
  const summaryText = summaryRow ? renderSummary(summaryRow.summary) : '';
  let keptSummary = summaryText;
  if (keptSummary && approximateTokens(keptSummary) > remaining) {
    const allowed = Math.max(0, remaining);
    keptSummary = allowed > 20 ? keptSummary.slice(0, allowed) + '…' : '';
  }
  remaining -= approximateTokens(keptSummary);

  const keptFacts = [...facts];
  let factsText = renderFacts(keptFacts);
  while (keptFacts.length && approximateTokens(factsText) > remaining) {
    keptFacts.pop();
    factsText = renderFacts(keptFacts);
  }
  if (!keptSummary && !factsText) return EMPTY_MEMORY_CONTEXT;

  const text = [keptSummary, factsText].filter(Boolean).join('\n\n');
  return {
    injected: true,
    summary: keptSummary ? summaryRow?.summary ?? null : null,
    facts: keptFacts,
    text,
  };
}
