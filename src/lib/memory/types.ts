/**
 * 普通聊天记忆的类型与常量（V3 第 25 章）。
 *
 * 记忆分两层：一份按会话隔离的滚动摘要（conversation_memories），加上有限条
 * 关键事实（memory_facts）。故事会话继续走 StoryCheckpoint，不复用这两张表。
 */

/** 记忆摘要任务在 background_tasks 里的 kind。 */
export const MEMORY_SUMMARY_TASK = 'memory-summary';

/** 事实状态：ACTIVE 参与注入；INVALID 表示来源消息已被删除/编辑；DELETED 是用户删除。 */
export type MemoryFactStatus = 'ACTIVE' | 'INVALID' | 'DELETED';

export interface MemorySettings {
  /** 关闭后既不生成也不注入。 */
  enabled: boolean;
  /** 累计多少条新消息触发一次摘要任务。 */
  summaryTriggerMessages: number;
  /** 摘要长度上限（字）。 */
  summaryMaxChars: number;
  /** 生成时最多注入多少条有效事实。 */
  maxFacts: number;
  /** 角色设定＋事实＋摘要＋近期消息的总预算（token）。 */
  contextBudgetTokens: number;
}

export interface MemoryFactView {
  id: string;
  text: string;
  pinned: boolean;
  /** 事实来源消息；消息删除后由失效逻辑把事实置 INVALID，不保留外键。 */
  sourceMessageId: string | null;
  status: MemoryFactStatus;
  createdAt: string;
}

export interface MemorySummaryView {
  summary: string;
  coveredMessageId: string | null;
  version: number;
  updatedAt: string;
}

export interface MemoryContext {
  /** 是否真的注入：关闭记忆、或没有任何摘要与事实时为 false。 */
  injected: boolean;
  summary: string | null;
  facts: MemoryFactView[];
  /** 拼好的注入文本；injected=false 时为 null。 */
  text: string | null;
}

export interface MemoryFactInput {
  text?: unknown;
  sourceMessageId?: unknown;
  pinned?: unknown;
}

export class MemoryError extends Error {
  constructor(message: string, readonly status = 400, readonly code = 'MEMORY_INVALID') {
    super(message);
    this.name = 'MemoryError';
  }
}

export const EMPTY_MEMORY_CONTEXT: MemoryContext = {injected: false, summary: null, facts: [], text: null};
