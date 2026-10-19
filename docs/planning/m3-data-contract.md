# M3 故事数据与 API 契约草案

> 范围：V1 M3 数据/API 契约；不授权本次改源码或迁移。依据规划书第 15–20 章、M0 行为对照（docs/planning/m0-behavior-parity.md）及当前 SQLite/Prisma 结构。字段名可调整，但以下定义可直接映射 Prisma。所有时间 UTC；状态字符串在应用层受控枚举校验。

## 1. Prisma 草案

所有主键 id String @id @default(cuid())；时间 createdAt DateTime @default(now()) @map("created_at")、updatedAt DateTime @updatedAt @map("updated_at")；外键 snake_case；表名 snake_case。必填无默认值字段须由创建服务显式提供。

| Model / field | Prisma 类型、可空、默认 | 列名/约束 |
|---|---|---|
| StoryTemplate: id, slug, title, status, ownerId?, createdAt, updatedAt | id String；slug/title/status String；ownerId String?；时间标准字段 | ownerId @map("owner_id")；slug 全局唯一；owner User? onDelete SetNull（系统模板可空） |
| StoryTemplateVersion: id, templateId, version, locale, definitionJson, characterSnapshotJson, publishedAt?, createdAt | id/templateId/version/locale/JSON 均必填；publishedAt DateTime? | FK templateId @map("template_id") Cascade；JSON 两列分别 @map("definition_json"), @map("character_snapshot_json")；不可变发布版本 |
| StoryRun: id, userId, conversationId, templateVersionId, chapterKey, status, revision, lastCommittedTurnNo, stateProcessedThroughTurnNo, stateJson, createRequestId, activeTurnId?, startedAt, endedAt?, createdAt, updatedAt | id/外键/chapterKey/status/JSON/createRequestId/时间必填；revision Int @default(0)，lastCommittedTurnNo Int @default(0)，stateProcessedThroughTurnNo Int @default(0)，status String @default("ACTIVE")；activeTurnId String?；endedAt DateTime? | userId @map("user_id"), conversationId @map("conversation_id"), templateVersionId @map("template_version_id"), chapterKey @map("chapter_key"), lastCommittedTurnNo @map("last_committed_turn_no"), stateProcessedThroughTurnNo @map("state_processed_through_turn_no"), stateJson @map("state_json"), createRequestId @map("create_request_id"), activeTurnId @map("active_turn_id")；unique(conversationId), unique(userId,createRequestId), unique(activeTurnId)；FK user Cascade、Conversation Cascade、Version Restrict |
| StoryTurn: id, runId, turnNo, requestId, requestHash, status, inputMessageId?, assistantMessageId?, operation, stateStatus, stateAttempts, errorCode?, startedAt, committedAt?, leaseOwner?, leaseExpiresAt?, createdAt, updatedAt | id/runId/turnNo/requestId/hash/status/operation/stateStatus/attempts/startedAt 必填；message/error/committed/lease 可空；status @default("ACCEPTED")；stateStatus @default("PENDING")；stateAttempts Int @default(0) | runId @map("run_id"), turnNo @map("turn_no"), requestId @map("request_id"), requestHash @map("request_hash"), inputMessageId @map("input_message_id"), assistantMessageId @map("assistant_message_id"), stateStatus @map("state_status"), stateAttempts @map("state_attempts"), errorCode @map("error_code"), startedAt @map("started_at"), committedAt @map("committed_at"), leaseOwner @map("lease_owner"), leaseExpiresAt @map("lease_expires_at")；FK run Cascade；unique(runId,requestId), unique(runId,turnNo), unique(inputMessageId), unique(assistantMessageId)；Message FK SetNull |
| StoryEvent: id, runId, sourceTurnId, chapterKey, type, status, payloadJson, sourceMessageId?, invalidatedAt?, createdAt, updatedAt | id/runId/sourceTurnId/chapterKey/type/status/payloadJson/timestamps 必填；sourceMessageId/invalidatedAt 可空；status @default("PENDING") | runId @map("run_id"), sourceTurnId @map("source_turn_id"), chapterKey @map("chapter_key"), payloadJson @map("payload_json"), sourceMessageId @map("source_message_id"), invalidatedAt @map("invalidated_at")；FK run/turn Cascade、Message SetNull |
| StoryCheckpoint（采用）: id, runId, throughTurnNo, revision, stateJson, invalidatedAt?, createdAt | id/runId/throughTurnNo/revision/stateJson/createdAt 必填；invalidatedAt 可空 | runId @map("run_id"), throughTurnNo @map("through_turn_no"), stateJson @map("state_json"), invalidatedAt @map("invalidated_at")；FK run Cascade；unique(runId,throughTurnNo,revision) |

StoryEvent.type：FACT、PROMISE、RELATIONSHIP、CHAPTER_RESULT；status：PENDING/CONFIRMED/REJECTED/INVALIDATED。StoryRun.status：ACTIVE/PAUSED/ENDED。StoryTurn.status：ACCEPTED/GENERATING/COMMITTED/FAILED/UNKNOWN/CANCELLED；stateStatus：PENDING/PROCESSING/PROCESSED/FAILED/INVALIDATED。以 String 保存枚举并由应用校验，匹配当前 schema 风格。

### 唯一约束与索引

- Template: @@unique([slug])；@@index([status, updatedAt, id]) 支持公开/审核模板列表。
- Version: @@unique([templateId, version, locale])；@@index([locale, publishedAt]) 支持按语言取已发布版本。
- Run: @@unique([conversationId]) 保证一对一；@@unique([userId, createRequestId]) 创建幂等；@@unique([activeTurnId]) 唯一活动回合槽（NULL 可重复）；@@index([userId, updatedAt, id]) 用户最近故事列表；@@index([templateVersionId]) 版本引用/下架影响检查。
- Turn: @@unique([runId, requestId]) 幂等；@@unique([runId, turnNo]) 稳定顺序；@@unique([inputMessageId])、@@unique([assistantMessageId]) 防消息重复归属；@@index([runId, stateStatus, leaseExpiresAt]) worker 待处理/过期租约扫描；@@index([runId, turnNo, status]) 回合读取和失效。
- Event: @@index([runId, sourceTurnId, status]) 按来源回合重建/失效；@@index([runId, chapterKey, status, createdAt]) 章节事件视图；@@index([sourceMessageId]) 消息编辑/删除定位。
- Checkpoint: unique(runId,throughTurnNo,revision)；@@index([runId, invalidatedAt, throughTurnNo]) 最近有效快照查询。

## 2. SQLite 与 JSON 字符串校验

SQLite 本项目不使用 Prisma Json。definitionJson、characterSnapshotJson、StoryRun.stateJson、StoryEvent.payloadJson、StoryCheckpoint.stateJson 均为 String；requestHash 是普通文本 hash。JSON 字段由模板发布服务、story 应用服务、事件/快照纯领域 validator 在 parse 前后用版本化 schema 校验；DB 只保证文本与 FK/unique，不保证 JSON 语法。

校验失败：输入/发布内容返回 422 且不写入；已存坏 JSON 视为数据完整性故障，拒绝状态推进、不覆盖原数据，将回合置 stateStatus=FAILED 并写无正文 errorCode，保留已持久化聊天回复供修复/重试。日志不得输出 JSON 正文、用户输入、提示词或秘密。

## 3. 关系、删除与自由聊天兼容

Conversation 当前 user FK Cascade、character FK Cascade，Message 对 Conversation Cascade；注销流程调用 eraseAccountConversations(tx,userId) 删除该用户会话。StoryRun 通过唯一 conversationId FK 形成 1:1；Run 同时有 userId，创建时必须等于 Conversation.userId，读取时两者均校验。Conversation 删除级联删 Run、Turn、Event、Checkpoint；User 注销时同一注销事务清理其 Conversations，Run 随之级联清理，模板版本不删。StoryTemplate 删除其版本 Cascade，但版本一旦被 Run 引用则 Restrict；作者删除/注销不删除已发布版本（ownerId SetNull）。

历史 Conversation 默认没有 StoryRun；普通聊天读写在查无 Run 时完整执行既有路径，无故事状态校验/抽取，不改原 SEND/REGENERATE 的限流、额度、错误、SSE 语义。只有创建 StoryRun 后才进入故事专用编排。旧消息路由必须在既定 chat-application-service 按 conversationId 查 Run 并分流/拒绝故事回合，不能靠前端标志，也不能让旧路由绕过状态同步。M0 行为对照中普通发送与重生成差异逐项保留。

## 4. 迁移策略与待拍板

新增模型本身可纯增量：只 CREATE 新表/索引/FK，不回填历史会话；历史 Run 缺失天然表达自由聊天。StoryRun 对 Conversation 的反向关系字段只加 Prisma schema，物理上不需 ALTER conversations，因为 FK 在 StoryRun 表侧。

但旧接口必须识别已关联 Run。方案 A（推荐）：chat-application-service 只查新 StoryRun 表，按 Run 缺失/存在选择原聊天/故事编排；无冗余列，可纯增量。方案 B：给 Conversation 增 nullable storyRunId/状态列作标记；须 ALTER conversations，重复真相需原子同步且回滚复杂。推荐 A，因为规范化 FK 已足够。**待拍板：A/B，推荐 A。**

迁移目录建议：20261020100000_story_run_contract（晚于当前最后 20261017120000_payment_checkout_policy；执行前检查分支实际是否已有更晚迁移并顺延）。回滚：先关闭故事写入/worker并部署兼容代码、备份；无需保留新数据时可按逆依赖 DROP 新表；已有 Run 数据后不能直接删表，需数据负责人批准。禁止改旧消息回填。

**待拍板：删除/注销保留。** A（推荐）：Conversation 删除 Cascade 清除 Run 数据；注销沿用现有事务清会话；符合私有聊天删除语义。B：脱敏保留 Run/Turn 作统计，需要独立匿名化、正文与 FK 脱敏设计，超出 M3。推荐 A，因为故事派生数据可能敏感。

## 5. /api/story-runs 契约

全部端点 Bearer 登录；每次读写校验所有权、角色/内容可见性及来源消息归属。路径 ID 不授权访问。成功 DTO 不返回 DB 内部 leaseOwner、提示词或私有字段。

| 方法 + 路径 | 请求 | 成功响应 |
|---|---|---|
| GET /api/story-runs | query cursor?: string, limit?: number（默认20，1–100） | {items: StoryRunSummary[], nextCursor: string|null} |
| POST /api/story-runs | {templateVersionId, chapterKey, requestId}，仅已发布版本；requestId 创建幂等键 | 201 {run: StoryRunView}；同键重试回原 run（200） |
| GET /api/story-runs/:id | 无 | {run: StoryRunView} |
| POST /api/story-runs/:id/turns | {expectedRevision:number, requestId:string, content:string}，1–5000 字 | SSE accepted{turnId,revision}、delta{turnId,content}、committed{turnId,userMessageId,assistantMessageId,revision}、state_pending{turnId,stateStatus}、error{code,message}、done{turnId}。done 不等于提交；以 committed/GET 确认。 |
| POST /api/story-runs/:id/turns/:turnId/retry-state | {expectedRevision:number}，只重试状态整理，不重发模型 | {turnId,stateStatus:'PENDING'} |
| POST /api/story-runs/:id/close-chapter | {expectedRevision:number} | {run: StoryRunView}；条件不成立 422，不接受客户端完成事实 |
| POST /api/story-runs/:id/resume | {expectedRevision:number} | {run: StoryRunView} |

StoryRunView 字段：id, conversationId, template:{id,version,locale,title,publicSummary}, chapter:{key,title}, status, revision, lastCommittedTurnNo, stateProcessedThroughTurnNo, events:[{id,type,status,chapterKey,payload,sourceMessageId,createdAt}], turns:[{id,turnNo,status,stateStatus,inputMessageId,assistantMessageId,errorCode,committedAt}], createdAt, updatedAt。只包含当前用户可见的审核公开模板字段、已确认事件与处理状态；**不得包含隐藏事实、完整提示词、密钥、其他用户信息或未授权消息内容**。不在 View 放完整聊天正文；消息沿用现有授权 conversation messages API。Summary 仅 id,conversationId,templateTitle,chapterKey,status,revision,updatedAt。

错误：401 无有效登录；403 Run 不属当前用户或角色/内容无权访问；404 Run/版本/消息不存在或对当前用户不可见（防枚举）；409 expectedRevision 过期、requestId 同键不同 hash、活跃生成冲突；422 参数/JSON schema 错、章节条件不满足、sourceMessage 不属 Run；429 用户限流/额度限制（沿用现有额度错误与 Retry-After）；503 AI/存储/worker 不可用或 SQLite 写锁超时（仅明确未启动操作可重试）；500 未知内部错误且不泄露细节。

expectedRevision 是 StoryRun 乐观版本：写入前比较；每个状态变更事务成功时递增一次。回合接受、整理提交、关闭/恢复、失效各按事务更新并返回新 revision。不匹配返回 409 {code:'REVISION_CONFLICT',currentRevision,run}，客户端刷新，不自动覆盖/重放生成。

## 6. 幂等、单实例生成与持久恢复

StoryTurn (runId,requestId) unique 存幂等记录；requestHash 对规范化请求计算，不进入分析日志。相同键/相同 hash 返回同一 turn；不同 hash 返回 409。Run 创建幂等由 StoryRun.createRequestId 和 @@unique([userId,createRequestId]) 实现，与接口 requestId 一致。

SQLite 单写者不等于应用层串行。接受回合时短事务做 StoryRun revision CAS（updateMany where id/userId/revision，revision + 1）并创建 StoryTurn；另在 Run 增 activeTurnId String? @unique @map("active_turn_id")，事务内仅当空时设值，提交/失败/取消时清空。唯一槽保证同一 Run 至多一生成回合；busy 返回 409。沿用 WAL + busy_timeout；不跨模型网络调用持有事务，也不承诺外部模型恰好一次。

持久租约使用 StoryTurn 的 leaseOwner String?、leaseExpiresAt DateTime?、stateStatus、stateAttempts Int @default(0) @map("state_attempts")。worker 对 PENDING 或过期 PROCESSING 做条件更新认领并设 owner/expiry；提交需 owner 匹配且 lease 未过期。消息事务同时保存 USER/ASSISTANT、turn message IDs、COMMITTED、state PENDING、Run lastCommittedTurnNo；事务提交后 worker 扫描表，不用裸 Promise。

崩溃恢复：到期 PROCESSING 状态任务可被重新认领，整理需幂等；已提交消息对应 turn 永不自动重发模型。模型生成中断且上游结果未知时标 UNKNOWN，先查本地消息/AI 调用记录；用户确认后才可用新 requestId 重试。超时恢复只重做状态整理，不重复扣费/生成。状态失败保留已保存回复并显示整理失败。

## 7. 编辑/删除回合失效事务

编辑或删除故事消息 N 时，同一事务读取其稳定 turnNo（不以 createdAt 或前端数组下标排序），执行原消息变更，再将 StoryEvent 中 sourceTurn.turnNo >= N 的行设 status=INVALIDATED、invalidatedAt=now()；StoryCheckpoint where throughTurnNo >= N 设 invalidatedAt；相关 StoryTurn.stateStatus=INVALIDATED；StoryRun.stateJson 重建为最近有效 checkpoint/确认事件，lastCommittedTurnNo 与 stateProcessedThroughTurnNo 回退至 N-1，revision + 1。CHAPTER_RESULT 是 StoryEvent.type，按同规则失效。

消息服务与 stories 必须由同一 chat-application-service 事务协调，避免消息变更成功而事件仍有效。旧自由聊天原编辑/重生成契约逐项保持。新故事顺序采用 StoryTurn.turnNo + message ID；当前 Message createdAt 同刻排序不足以定义因果。若 interactive transaction 无法覆盖既有消息服务调用，先抽取共享事务入口再开放故事历史修改；不能用两个事务冒充原子性。

## 8. 明确不做

- 不做向量检索：先按章节/事件/标签检索，实测召回不足再评估。
- 不做多引擎抽象：复用现有模型路由和单次聊天服务，避免平行平台。
- 不拆微服务：维持 Next + SQLite，减少部署、事务与运维边界。
- 不让前端判章/确认事实：服务端规则和带来源事件是权威。
- 不自动把旧会话迁成 StoryRun：避免把历史文本误作可信事实。
- 不承诺外部模型恰好一次：网络未知结果无法证明未计费，故不自动重试。
- 不用请求后裸 Promise 做后台任务：进程退出会丢任务，必须持久化 turn/lease。
- 不把隐藏事实、提示词、密钥或完整正文发给前端/分析日志：保护隐私和剧情边界。

## 9. 待拍板

1. 旧聊天识别故事会话：A chat-application-service 按 StoryRun 查找并分流（推荐，无冗余列且纯增量）；B Conversation 加标记列（ALTER、重复真相和同步风险）。
2. 用户注销保留：A 随会话事务 Cascade 清除私有故事数据（推荐，符合现有聊天擦除）；B 脱敏保留统计（需匿名化与期限设计，不建议进 M3）。
3. 并发锁：A StoryRun.activeTurnId 唯一槽 + revision CAS 短事务（推荐，SQLite 兼容）；B 单独 StoryRunLease 表（多模型与运维面，A 不足再评审）。
4. Run 创建幂等：A createRequestId + @@unique([userId,createRequestId])（推荐，超时重试不重复建实例）；B 无幂等键（可能生成重复 Run）。接口已要求 requestId，需拍板 A。

本稿需待拍板项闭合、事务调用链和 runbook 确认后，才能写 schema/migration。
