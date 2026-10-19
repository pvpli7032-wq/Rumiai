# M0 聊天应用服务边界与接口草案

依据规划书第14章153–165行及当前源码。接口是类型级草案，不代表已实现。

## 职责边界
服务只覆盖一次完整聊天回合：身份/会话所有权、限流、额度预留与结算、用户消息落库、调用现有流式生成、助手消息落库和返回回合结果。明确不做通用生成平台、不做多引擎抽象。提示词、模型选择/回退及SSE仍由chat-stream负责；故事模块只在上下文构造前注入受控上下文、提交后入队状态处理，不直接写消息。账号、支付、余额、社区等保持现有模块所有权。

## 类型级接口签名草案

```ts
export type ChatTurnMode = 'SEND' | 'REGENERATE';
export interface ChatTurnRequest {
  actor: { userId: string };
  conversationId: string;
  mode: ChatTurnMode;
  input: { content: string } | { targetMessageId: string };
  request: Request;
  storyContext?: { runId: string; revision: number; promptContext: string };
}
export interface ChatTurnResult {
  callId: string;
  mode: ChatTurnMode;
  stream: ReadableStream<Uint8Array>;
  committed: Promise<{ assistantMessageId?: string; status: 'SUCCEEDED'|'MOCK'|'FAILED'|'CANCELLED' }>;
}
export interface ChatApplicationService { execute(input: ChatTurnRequest): Promise<ChatTurnResult>; }
```

这是接口边界表达，不声称已有实现。普通发送源码在src/app/api/conversations/[id]/messages/route.ts:38-109；重生成在src/app/api/conversations/[id]/messages/[messageId]/regenerate/route.ts:40-100。chat-stream职责见src/lib/conversations/chat-stream.ts:1-8,198-290。

## 模块图

```text
HTTP routes (SEND / REGENERATE): auth, params, JSON, HTTP errors, SSE headers
  -> chat-application-service: one complete chat turn only
       -> conversations: ownership, history, save/replace message
       -> ai: availability, reserve/finish call, metrics
       -> chat-stream: prompt + fallback + upstream SSE
       -> rate-limit: burst check
       -> stories (optional hooks): buildContext before / observeCommittedTurn after
stories owns templates/runs/turns/events/checkpoints, never chat message persistence.
No generic generation gateway; no independent service cluster.
```

迁移需保持两路由错误码、限流文案、额度不足提示及断流行为。规划书第14章160–165行。