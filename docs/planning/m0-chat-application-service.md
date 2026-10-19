# M0 聊天应用服务边界与接口（已实现）

依据规划书第14章153–165行及当前源码。**状态：已实现并接入两个调用方**（`src/lib/conversations/chat-application-service.ts`，2026-10-20）。下文先记实际落地的接口，再保留原始草案供对照；两者不一致处以「实际接口」一节为准。

## 职责边界
服务只覆盖一次完整聊天回合：身份/会话所有权、限流、额度预留与结算、用户消息落库、调用现有流式生成、助手消息落库和返回回合结果。明确不做通用生成平台、不做多引擎抽象。提示词、模型选择/回退及SSE仍由chat-stream负责；故事模块只在上下文构造前注入受控上下文、提交后入队状态处理，不直接写消息。账号、支付、余额、社区等保持现有模块所有权。

## 实际接口

```ts
export type ChatTurnMode = 'SEND' | 'REGENERATE';
export type ChatTurnInput = {request: Request} | {targetMessageId: string};
export interface ChatTurnRequest { userId: string; conversationId: string; mode: ChatTurnMode; input: ChatTurnInput; signal: AbortSignal; }
export interface ChatTurnResult { mode: ChatTurnMode; stream: ReadableStream<Uint8Array>; }
export class ChatTurnHttpError extends Error { constructor(message: string, readonly status: number, readonly headers?: HeadersInit); }
export async function executeChatTurn(input: ChatTurnRequest): Promise<ChatTurnResult>;
```

与草案的差异（均为实现期收敛，非能力删减）：

1. 草案的 `input: {content: unknown} | {targetMessageId}` 改传 `{request: Request}`。原因是「畸形 JSON 返回 400」必须在会话所有权校验之后才发生——若在路由里先 `request.json()`，未登录/非本人会话会先拿到 400 而不是 401/403，改变了既有优先级。解析因此移进服务。
2. 草案的 `committed: Promise<...>` 未实现。实际是流在持久化完成后才发 `[DONE]`（与改造前的语义一致），调用方拿不到独立承诺对象。将来故事接口需要 `committed` 事件时再按第19章新增，不在本次预留。
3. 草案的 `storyContext?` 钩子未实现——M3 尚未开始，现在没有任何调用方。加一个空钩子只会让边界看起来已就绪。
4. 路由错误映射统一为 `ChatTurnHttpError`（带 status 与 headers）优先，其后依次 `ConversationError`、`ConversationMessageError`、`AiQuotaError`。

## 类型级接口签名草案（历史，仅作对照）

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

## 验收证据（2026-10-20）

| 项 | 命令 | 结果 |
|---|---|---|
| 类型 | `npx tsc --noEmit` | 通过 |
| 完成定义 | `node scripts/check-definition-of-done.mjs` | 全部通过 |
| 服务级行为 | `node --import tsx --test tests/chat-application-service.test.mjs` | 7/7 |
| 路由行为 | `node tests/m0-route-behavior.test.cjs` | 14/14 |
| 上下文隔离 | `node --test tests/m2-context.test.cjs` | 4/4 |
| 守卫与回归形态 | `node --experimental-strip-types --test tests/launch-safety.test.mjs` | 通过 |
| 会话服务 | `node --import tsx --test tests/conversation-message.test.mjs tests/conversation-service.test.mjs` | 6/6 |
| 浏览器 | `DISABLE_MOCK_AI=false node scripts/run-browser-matrix.mjs test:browser` | 9 PASS / 1 SKIP |
| 生产门禁 | `node scripts/run-production-guards.mjs` | 2/2 |
| 构建 | `npm run build` | 通过 |

三个既有测试（`m0-route-behavior`、`m2-context`、`launch-safety`）在抽取后一度失效，因为它们把替身塞给了路由的 import 表。修法是**加载真实服务**而不是给服务再加替身——否则「A/B 会话不串角色」「无密钥不写消息不扣额度」这类断言会变成对替身的自证。