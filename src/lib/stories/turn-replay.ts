import {createHash} from 'node:crypto';
import type {Prisma} from '@prisma/client';

/**
 * 故事回合的幂等记录与重放（V3 表 17「重复请求」）。
 *
 * 同一 (runId, requestId) 配同一 requestHash 是重放：返回原回合与同一费用单，
 * 不再调用模型、不再扣币；内容不同是冲突；FAILED/CANCELLED/UNKNOWN 是终态，
 * 原样回放而不是悄悄重生成。
 */

export type TurnRow = Prisma.StoryTurnGetPayload<Record<string, never>>;

export type ExistingKind = 'committed' | 'in-progress' | 'terminal';

export function requestHash(content: string): string {
  return createHash('sha256').update(JSON.stringify({schemaVersion: 1, content})).digest('hex');
}

export function classifyExisting(turn: Pick<TurnRow, 'status' | 'requestHash'> | null, hash: string): ExistingKind | 'conflict' | null {
  if (!turn) return null;
  if (turn.requestHash !== hash) return 'conflict';
  if (turn.status === 'ACCEPTED' || turn.status === 'GENERATING') return 'in-progress';
  if (turn.status === 'COMMITTED') return 'committed';
  return 'terminal';
}

const TERMINAL_ERROR: Record<string, {code: string; message: string}> = {
  FAILED: {code: 'TURN_FAILED', message: '回合未能完成，请使用新的请求重试。'},
  UNKNOWN: {code: 'TURN_UNKNOWN', message: '回合结果未知，请先查询回合状态确认后再重试。'},
  CANCELLED: {code: 'TURN_CANCELLED', message: '回合已取消，请使用新的请求重试。'},
};

export function replayTurn(run: {revision: number}, turn: TurnRow): {kind: 'replay'; turn: TurnRow; revision: number} {
  return {kind: 'replay', turn, revision: run.revision};
}

export function replayStream(replay: {turn: TurnRow; revision: number}, narration: Record<string, unknown>[] = []): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const push = (event: Record<string, unknown>) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      const turn = replay.turn;
      if (turn.status === 'COMMITTED') {
        push({type: 'committed', turnId: turn.id, userMessageId: turn.inputMessageId, assistantMessageId: turn.assistantMessageId, revision: replay.revision});
        push({type: 'state_pending', turnId: turn.id, stateStatus: turn.stateStatus});
      } else {
        const failure = TERMINAL_ERROR[turn.status] ?? {code: 'TURN_FAILED', message: '回合未能完成，请使用新的请求重试。'};
        push({type: 'error', turnId: turn.id, code: turn.errorCode ?? failure.code, message: failure.message});
      }
      for (const event of narration) push(event);
      push({type: 'done', turnId: turn.id});
      controller.close();
    },
  });
}
