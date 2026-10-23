import type {DisputeExcerptMessage, DisputeVerdict, DisputeVoteState} from '@rumiai/contracts/disputes/types';

/**
 * 评理案例里几个 JSON 列的解析。
 *
 * 这些列可能是历史版本写的、也可能被手工改坏，所以一律「解析不了就退化成空」，
 * 不抛错 —— 一条脏数据不该让整个列表或详情页打不开。
 */

export function parseExcerpt(raw: string | null | undefined): DisputeExcerptMessage[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap(item => {
      if (!item || typeof item !== 'object') return [];
      const row = item as Record<string, unknown>;
      if (typeof row.messageId !== 'string' || typeof row.content !== 'string') return [];
      return [{messageId: row.messageId, role: row.role === 'USER' ? 'USER' as const : 'ASSISTANT' as const, content: row.content, createdAt: String(row.createdAt ?? '')}];
    });
  } catch {
    return [];
  }
}

export function parseVerdict(raw: string | null): DisputeVerdict | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as DisputeVerdict;
    return typeof parsed.text === 'string' && (parsed.status === 'READY' || parsed.status === 'FALLBACK') ? parsed : null;
  } catch {
    return null;
  }
}

export function voteState(vote: {choice: string; reviseCount: number} | null | undefined, maxVoteChanges: number): DisputeVoteState | null {
  if (!vote || (vote.choice !== 'AUTHOR' && vote.choice !== 'OTHER' && vote.choice !== 'SPLIT')) return null;
  return {choice: vote.choice, reviseCount: vote.reviseCount, maxVoteChanges, remainingChanges: Math.max(0, maxVoteChanges - vote.reviseCount)};
}
