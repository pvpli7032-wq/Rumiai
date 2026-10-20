# 故事 API 越权与信息泄露独立复核（commercial-refactor，M3/M4/M5 发布前）

**结论：需改后再上线。** 未发现跨用户读取他人故事内容的直接越权（他人 runId 在所有端点统一 404，StoryRunView 与导出 JSON 的内部字段白名单逐字段核对无泄露）；但需先修 1 项 P0 与 5 项 P1：**P0** 删除/编辑消息后其派生摘要仍可经导出/重试/分享三条旁路回到用户可读范围；**P1** 依次为回合幂等预检查先于授权、导出越过「故事回合消息」边界、详情遇整理中回合必 500、两处导出口径互相矛盾、分享快照结构不满足契约。另有 6 项 P2 一致性与文档对齐问题，逐条修法见下表。

> 复核方式：逐个文件读源码（非注释），并用行号回查确认；未运行测试与构建（按要求）。本机读取工具在复核中途出现次生故障，后半段改用本地文件读取完成，行号均二次核对。

## 复核结论后的处置（2026-10-21，Lead 已实施）

上表是**复核当时的代码状态**。P0 与全部 P1 已按"建议修法"落地，逐条对应：

| 编号 | 处置 | 落地位置 |
|---|---|---|
| S1 | 已修：失效事件改为清空 payload（不再只置状态）；导出只取 `status != INVALIDATED`；retry-state 对消息已不存在的回合拒绝重试；引用被删消息的分享同事务置 WITHDRAWN 并清空快照 | `lifecycle/invalidation.ts`、`lifecycle/export-service.ts`、`lifecycle/chapter-service.ts` |
| S2 | 已修：`requireVisibleRun` 提到幂等查询之前 | `turn-service.ts` |
| S3 | 已修：导出只含该 run 各回合自己的消息 | `lifecycle/export-service.ts` |
| S4 | 已修：视图对无法校验的事件跳过并计数告警（与导出口径一致），不再抛 422 | `repository/run-service.ts` |
| S5 | 已修：契约 §12.3 明确两处口径互补（会话段给全文，故事段给簿记），代码按此实现 | `m3-data-contract.md` §12.3 |
| S6 | 已修（数据层）：分享新增 `snapshotJson` 固化公开标题与选中片段 + `story_share_turns` 关联；读者入口仍不开放，开放前需补 GET 与 WITHDRAWN→404 集成测试 | `lifecycle/share-service.ts`、schema `StoryShare.snapshotJson`/`StoryShareTurn` |
| S7 | 已修：追加 conversationId 归属校验 | `lifecycle/share-service.ts` |
| S8 | 已修：导出不再输出 selectedMessageIds/publishedPostId，改输出快照与 messageCount | `lifecycle/export-service.ts` |
| S9 | 已修：注册点从路由副作用导入移到 `src/instrumentation.ts`（常驻组合根） | `src/instrumentation.ts` |
| S10 | 已修：契约第 5 节改为"他人 Run 一律 404，不用 403"并写明理由 | `m3-data-contract.md` §5 |
| S11 | 无需改动（复核结论即如此） | — |
| S12 | 已随 S1 一并修复（retry 前校验消息存在 + 失效清 payload） | 同 S1 |

回归证据：`tests/story-lifecycle-w07.test.mjs` 新增「删除消息后派生摘要不可复活」用例（失效 payload 清空、导出不含已删摘要、retry 拒绝、分享自动撤回且快照无正文、消息关联置空）；`tests/story-turn-service.test.mjs` 新增「先鉴权再幂等」用例（陌生人复用 requestId 仍得 404）。两文件与全套 story/chat 测试全绿。

## 问题清单

| 编号 | 严重度 | 位置 | 问题 | 证据 | 建议修法 |
|---|---|---|---|---|---|
| S1 | **P0** | `src/lib/stories/lifecycle/invalidation.ts:25-28`；`src/lib/stories/repository/run-service.ts:48-55`；`src/lib/stories/lifecycle/export-service.ts:21-25,57`；`src/lib/stories/lifecycle/share-service.ts:45-55` | 用户删除/编辑消息后，被删原文的派生摘要并未真正消失：①事件只置 INVALIDATED，`payloadJson` 原文保留，`GET /api/story-runs/[id]/export` 无条件导出（`export-service.ts:46-50` 查询无 status 过滤，`:57` 仅校验信封格式、不过滤 INVALIDATED，`:25` 还显式输出 `invalidatedAt`），**失效摘要原文进入用户下载的导出文件**；②详情视图仅因 `sourceTurn.stateStatus: 'PROCESSED'` 过滤（`run-service.ts:45`）而隐藏，一旦 `retryStoryState` 把已被删除消息的回合重新整理成功（`chapter-service.ts:24-48` 不检查消息是否仍存在），该事件重新出现，`stateJson` 也会重新吸收这些摘要；③分享在创建时只存消息 id（`share-service.ts:49-55`），删除消息后 StoryShare 仍为 PUBLISHED，未来读者入口展开时会出现已删原文。 | 与 `docs/planning/m1-story-privacy.md:18`（来源消息删除后须清理/失效并重建）、`:43`（用户删除的消息及其派生记忆不得再进入提示词、导出或分享）、`:82`（永不白名单「私聊全文」）冲突；与 `docs/planning/m3-data-contract.md:160`「导出永不包含他人任何数据」意图一致但实现未覆盖已删内容。`tests/story-lifecycle-service.test.mjs:256-258` 证明事件只被置 INVALIDATED 而未被清除。 | 导出侧只导出 `status='CONFIRMED' && invalidatedAt=null`（`export-service.ts:46-50`，若保留失效行则必须删掉 payload）；失效事务里把失效事件的 `payloadJson` 改写为不含正文的占位（如 `{"schemaVersion":1,"invalidated":true}`）或直接删除该行；`retryStoryState` 对消息已不存在的回合拒绝重试；删除消息时在同一事务把包含该消息的分享置 WITHDRAWN。 |
| S2 | P1 | `src/lib/stories/turn-service.ts:166-169` | 未做所有权校验即向调用者报告**他人 run 的回合状态**：幂等快速路径先用「我的 userId + 任意 runId + 我自选 requestId」直接查 `storyTurn`，命中就抛 `REQUEST_CONFLICT`/`TURN_IN_PROGRESS`（409），只有 `committed/terminal` 分支才走 `requireVisibleRun`（`:171`）。他人 runId + 自选 requestId 不可能命中，所以实际结果仍是 404，但「他人实例**是否正有回合在生成**」这类跨用户运行状态可由命中结果推知，且授权发生在返回 409 之后。 | 与 `docs/planning/m1-story-privacy.md:55`（必须先认证再用数据库资源归属授权）冲突；`m3-data-contract.md:53`「路径 ID 不授权访问」。仓库无对应跨用户测试（`tests/story-turn-service.test.mjs` 无他人 runId 用例）。 | 把 `requireVisibleRun` 提到 `:167` 之前（先解析 run，再做幂等查询），或至少把查询约束为 `where: {runId, requestId, run: visibleWhere(userId)}`。 |
| S3 | P1 | `src/lib/stories/lifecycle/export-service.ts:30-51` | 「下架后可查看历史」的读取放宽，没有限制在本人实例：导出白名单里的 `messages` 取的是整条会话全部消息（`:37-41` 只按 `conversationId` 过滤），而 `requireVisibleRun` 在模板下架（`status: 'DRAFT'/'REJECTED'`）后仅因本人拥有就放行；写路径有 `requirePublishedTemplate` 兜底（`run-service.ts:22-26` 被 `turn-service.ts:66,178`、`chapter-service.ts:102` 调用），读路径没有同等收紧。实例本身仍只能本人读，故不构成跨用户越权，但与「下架后只能看历史」的边界不严。 | `requireVisibleRun` 见 `run-service.ts:9-14,29-33`；导出未在任何一处检查 `template.status`，同样适用于账户档案（`exportAccountStories` `:73-81` 只按 `userId` 过滤，故意跳过模板块——符合契约 `m3-data-contract.md:162`）。 | 明确导出范围：若只应导出故事回合消息，按 `storyTurn.inputMessageId/assistantMessageId` 取；若确需整段会话，请在契约中写明并对下架模板保持同一口径（避免同一实例在两个导出入口口径不同）。 |
| S4 | P1 | `src/lib/stories/repository/run-service.ts:40-43`；`src/app/api/story-runs/[id]/route.ts:10` | 详情不做 `stateStatus` 兜底就无法对外表达「整理中/失败」的回合，模板返回真实 422，**真实用户即可把该端点打成 500**：只要某回合已 COMMITTED 但按最早 100 条取到的任一回合 `stateStatus` 仍是 `PENDING/PROCESSING/FAILED`，事件信封校验就会抛 422（`run-service.ts:53-55`），并被 `storyErrorResponse` 原样返回。批量 `retry-state` 后可稳定复现，属于可用性问题而非越权。 | 回合按 `turnNo desc, take 100`，事件按 `createdAt desc, take 100` 独立取（`:40-47`），两者不同步导致必然出现「事件有、来源回合当前不可见」的窗口；同一数据口径在 `export-service.ts:21-27` 是「跳过」，两处行为不一致。 | 统一口径：视图侧对无法校验的事件跳过并计数告警（与导出对齐），或按 `stateProcessedThroughTurnNo` 过滤事件（`turnNo <= stateProcessedThroughTurnNo`）。 |
| S5 | P1 | `docs/planning/m3-data-contract.md:160` 与 `src/lib/stories/lifecycle/export-service.ts:37-41,66-67`；`src/lib/stories/lifecycle/export-service.ts:73-81` 与 `:58-68` | 同一份私有内容在两处导出里口径相反，互不可自洽：按实例导出携带本人会话**全部消息正文**，账户档案导出刻意「不含消息正文」并称其已在 conversations 段；反之 conversations 段（`src/lib/accounts/data-export.ts:16-22`）携带**故事会话**的全部消息正文，而账户档案的 stories 段不带。用户与审计方无法从任一口径判断「故事正文是否在导出范围内」。 | 契约 `m3-data-contract.md:160` 写「本人 conversation 消息」，`:161` 写「不含消息正文」；两处代码位置见左。 | 二选一并写入契约：要么两处都带故事消息（标注来源 run/turn），要么两处都只带 turn 簿记。 |
| S6 | P1 | `src/lib/stories/lifecycle/share-service.ts:20-37,53-57` | 分享快照不是「用户选定并确认后的快照」：只存 `title` + `selectedMessageIds`，不含模板/章节公开标题，也不含消息内容快照；读取端一无（`src/app/api/story-runs/[id]/shares/route.ts`、`shares/[shareId]/route.ts` 均无 GET），创建响应直接把消息 id 原样回给客户端（`shareView` `:33-36`）。因此「未授权读者能否看到撤回后的分享」「读者能否借分享读到模板私有字段」**当前无法验证**——没有读取路径可供复核，也没有回归测试。 | 契约 `m3-data-contract.md:155` 承诺「读者读取任何 WITHDRAWN 分享一律 404」「读者只获得 selectedMessageIds 对应消息的快照」；`m1-story-privacy.md:20,71` 要求快照固定且只含公开模板/章节标题与选中片段；实现缺少快照字段（见左）。 | 上线前台读者入口前补：快照字段（模板公开标题、章节标题、选中片段内容）一次性固化，读者查询强制 `status='PUBLISHED'`，并把「WITHDRAWN→404」写进服务层与集成测试；在那之前前台入口不得开放（现状确实未开放，故不单独计为线上漏洞）。 |
| S7 | P2 | `src/lib/stories/lifecycle/share-service.ts:45-52` | 分享选择范围与契约不符：只校验消息属于本 run 的已提交回合，未校验消息仍在会话中，于是**同一会话里不属于任何故事回合的消息（含故事创建前的开场白等）也可以被分享**；同时删除消息后旧分享仍保留其 id（S1③）。 | 契约 `m3-data-contract.md:153` 写「全部属于本 run 的 COMMITTED 回合」；代码仅 `storyTurn.where(runId, status COMMITTED)`，没有 `message.conversationId` 约束（见左）。 | 追加 `message: {conversationId: run.conversationId}` 约束，并同事务校验消息存在。 |
| S8 | P2 | `src/lib/stories/lifecycle/export-service.ts:52-56,67` | 导出携带本人分享记录的 `selectedMessageIds` 与 `publishedPostId`（原样 id 数组/外键），与 `m1-story-privacy.md:82`「永不白名单 messageId/turnId 等内部 id」相左。属于本人数据，泄露面仅为本人下载文件，故列 P2 供一致性修正。 | 见左；契约 `m3-data-contract.md:160` 只写「本人分享记录」，未定义粒度。 | 改为导出 `{id,title,status,withdrawnAt,createdAt,count}`，或修订 m1 白名单说明故事导出确需保留关联 id（`m1-story-privacy.md:27` 又要求保留关联 ID，需在文档层拍板）。 |
| S9 | P2 | `src/lib/conversations/message-service.ts:139`（作用范围见 `invalidation.ts:17-76`） | 失效依赖「组合根 import」注册：只有 `src/app/api/conversations/[id]/messages/[messageId]/route.ts:8` 导入 `stories/lifecycle/invalidation`，同类消息改动路径 `chat-application-service.ts:70` → `message-service.ts:76-84 replaceMessageReply` 完全不调用失效钩子，一旦故事会话重新生成走通（`chat-application-service.ts:24` 目前以 409 拦截），会出现「消息已替换、事件仍有效」。未注册时消息服务会 503 失闭（`message-service.ts:19-23`），所以这是**潜在**窗口而非现网可利用漏洞。 | 见左；`registerStoryHistoryInvalidator` 仅在 `invalidation.ts:74` 调用一次。 | 把注册下沉到常驻的服务入口（如 `src/instrumentation.ts` 或 `message-service` 的组合根），不要依赖单个路由文件的副作用导入；`replaceMessageReply` 路径补齐失效调用。 |
| S10 | P2 | 全部 `src/app/api/story-runs/**/route.ts`；服务层 `src/lib/stories/**` 中 `403` 出现 0 次 | 状态码与契约不一致：他人/不可见资源一律 404 且文案统一为「故事不存在或暂不可用」，无任何 403。防枚举策略本身**全站一致**（符合 `m1-story-privacy.md:60` 的「若统一 404 必须全站一致」条件），但契约 `m3-data-contract.md:67` 仍写「403 Run 不属当前用户」；文档与实现需拍板其一，否则将来加 403 就制造枚举侧信道。 | 见左（`src/lib/stories` 与 `src/app/api/story-runs` 内 grep 「403」均 0 命中）。 | 以 404 为准修订契约第 5 节错误表，并在测试里锁定「他人 runId → 404 且响应体与真不存在完全一致」。 |
| S11 | P2 | `src/lib/stories/repository/run-service.ts:116` | 列表游标使用他人或伪造 runId 时回 404（复用 `requireVisibleRun`），属一致行为；但游标参数因此成为「该 id 是否为本人可见 run」的判定入口——与详情端点等价，不新增泄露面，仅记录以证明已核对。 | 见左。 | 无需改动。 |
| S12 | P2 | `src/lib/stories/lifecycle/chapter-service.ts:56-90`；`invalidation.ts:25-28` | CHAPTER_RESULT 由结章写入，按契约应随失效一起作废；实际当「消息删除后把含 CHAPTER_RESULT 的回合重新整理成功」时，该回合被标回 PROCESSED，与同回合的已删消息不再对应，CHAPTER_RESULT 重新进入视图。成因与 S1② 同一条链路，此处单列以提示修法要覆盖 CHAPTER_RESULT。 | `closeChapter` 写事件见 `:79-86`；`retryStoryState` 无消息存在性校验见 `:24-48`。 | 同 S1：重试前校验来源消息仍存在，且失效时清除 payload。 |

## 已确认无问题（实际核对过的项）

1. **认证先于取数（全部 9 个路由）**：`story-runs/route.ts:9-10,18-19`、`[id]/route.ts:8-9`、`turns/route.ts:10-11`、`turns/[turnId]/retry-state/route.ts:8-9`、`resume/route.ts:8-9`、`close-chapter/route.ts:9-10`、`export/route.ts:11-12`、`shares/route.ts:11-12`、`shares/[shareId]/route.ts:11-12` 均为「未登录 401 → 再进服务」，无路由在认证前触碰数据库。
2. **服务层所有权与可见性在每次读写前执行**：`run-service.ts:9-14,29-33` 同时校验 `run.userId` 与 `conversation.userId`，并要求角色「本人创建或公开且审核通过」；`retry-state` 先 `requireVisibleRun` 再查 turn（`chapter-service.ts:27-28`），turn 查询带 `runId` 约束（防 IDOR）；`createStoryShare` 先 `requireVisibleRun`（`share-service.ts:42`）；`withdrawStoryShare` 用 `{id: shareId, runId, userId}` 一次查（`:63`），无「先取后验」。
3. **跨用户实际结果均为 404，文案统一**：`requireVisibleRun` 一律抛 `STORY_NOT_FOUND`（`run-service.ts:31`），经 `errors.ts:6` 原样输出；`tests/story-lifecycle-w07.test.mjs:75,180,187,198` 已锁定导出/分享创建/分享撤回的他人访问 404。
4. **回放路径不会泄露他人 run**：`acceptTurn` 的 P2002 兜底与 `createStoryRun` 的重放（`run-service.ts:84,104-107`）都限定 `userId_createRequestId` 本人键；`turn-service.ts:171` 回放前仍走 `requireVisibleRun`（唯一缺口是 S2 的 `166-169` 预检查）。
5. **StoryRunView 字段白名单逐字段核对无内部字段**：`run-service.ts:58-64` 只输出 id/conversationId/template{id,version,locale,title,publicSummary}/chapter{key,title}/status/revision/两个游标/events/turns/时间戳；模板详情由 `contracts.ts:50-64` 重新构造，**definitionJson 与 characterSnapshotJson 的其余字段（隐藏剧情、systemPrompt）不会被透传**；`output` 与 `input` 均无 `stateJson`、`leaseOwner`、`requestHash`、`createRequestId`、`activeTurnId`，也无他人信息或 userId。`turns` 只含 `{id,turnNo,status,stateStatus,inputMessageId,assistantMessageId,errorCode,committedAt}`（`:42`），无 requestHash/lease。
6. **事件只暴露公开信封**：`run-service.ts:53-54` 只映射 `{summary: publicSummary}`，不返回 payloadJson；并同时要求 sourceTurn 属本 run 且 COMMITTED/PROCESSED、sourceMessage 属本会话（`:45`）。
7. **导出 JSON 字段白名单无内部字段**：`export-service.ts:58-68` 只含 run 公开字段 + `messages{id,role,content,imageUrl,createdAt}` + `turns` 簿记（`:44`，无 requestHash/lease/requestId）+ 事件投影（`:25`）+ 本人分享；`tests/story-lifecycle-w07.test.mjs:96-98` 用隐藏剧情/提示词/stateJson/leaseOwner/requestHash/createRequestId/payloadJson 逐个断言不出现；账户档案版本 3 同样断言（`:162-165`）。**内部字段无泄露（S1 的问题是「已删内容的派生摘要」而非内部字段）。**
8. **账户档案故事段只按本人过滤**：`export-service.ts:74-81` `where: {userId}`，turn/event 用 `where: {run: {userId}}`（`:85,89`），无跨用户数据。
9. **未公开读者入口（分享「只暴露公开模板与用户选定片段」的前提成立）**：全仓仅 `export-service.ts` 与 `share-service.ts` 触碰 `storyShare`，`shares` 路由只有 POST/DELETE、无 GET，社区帖子/公开页未引用分享记录，`publishedPostId` 未被写入或读取。因此 S6/S7 是「前台开放前必须补齐」，当前不构成线上泄露。
10. **撤回不影响 run 本体**：`share-service.ts:61-74` 只更新分享行（`updateMany where {id, status:'PUBLISHED'}`），`tests/story-lifecycle-w07.test.mjs:192-195` 断言 revision/status/updatedAt 不变；重复撤回 409（`:65,72`）。
11. **下架读写分离的写门完整**：新回合 `turn-service.ts:66,178`、恢复 `chapter-service.ts:102` 均调用 `requirePublishedTemplate`（`run-service.ts:22-26`，422 STORY_OFFLINE）；创建时模板必须 PUBLISHED 且已到发布时间（`run-service.ts:90`）；回放路径也会因 `view()` 重新校验而走同一可见性（`run-service.ts:84`）。结章不调用——为契约 `m3-data-contract.md:162` 有意为之的簿记动作。
12. **下架后读不会读到他人实例**：读路径放宽的只是「模板是否 PUBLISHED」，`visibleWhere`（`run-service.ts:9-14`）始终保留 `userId` 与角色可见性，故不存在借下架读取他人 run 的路径（S3 仅是把「本人历史」的边界扩大到「整段会话导出」）。
13. **失效事务本身（消息与事件）在同一事务内**：`message-service.ts:144-153` 先解析 runId、再 `invalidateStoryHistory`、最后删除消息，全在 `db.$transaction` 内（`:145`）；编辑路径同理（`:118-141`）；未注册处理器时 503 失闭（`:19-23`）。不存在「消息删了、事件仍 CONFIRMED 仍进提示词」的窗口——残留的只是 S1 所述的导出/重试/分享三处旁路。
14. **失效后模型侧不再读到旧摘要**：`invalidation.ts:40-45,48-56` 从最近有效 checkpoint 重建 `stateJson` 并回退两个游标，`tests/story-lifecycle-service.test.mjs:266-268` 断言重建后 facts 为空。
15. **worker 提交有租约守卫、不会复活失效事件**：`state-worker.ts:245-249` 以 `stateStatus='PROCESSING' && leaseOwner=owner` 条件更新，失效抢先则整段不写；`invalidation.ts:33-36` 清租约。S1② 的复现需要用户主动调用 `retry-state`，不是 worker 自动行为。
16. **重试/结章的状态门与乐观并发**：`chapter-service.ts:30-34`（非 COMMITTED 422、PROCESSING 409、非 PENDING/FAILED 422）、`:60-65`（未 ACTIVE 409、无回合 422、状态未整理完 422）、CAS 更新带 `userId+revision`（`:35-38,66-69,103-106`），无客户端可伪造的章节完成事实。
17. **429/额度先拒绝且不泄露他人用量**：`turn-service.ts:188-190` 限流与额度按 `input.userId` 计；旗标在额度预留前拦截（`turns/route.ts:13`），F1/F3 同理（`story-runs/route.ts:21`、`close-chapter/route.ts:12`）。
18. **错误响应不泄露堆栈/正文**：`errors.ts:7-10` 未知错误只回 `Internal server error`；`src/lib/logger.ts:39-41` 只记录 errorName/errorCode/route，不记录消息正文或请求体。
19. **输入白名单拒绝越权字段**：`contracts.ts:23-26,28-38,41-47` 只取白名单键，客户端传入的 `userId`/`status`/`revision` 等一律被忽略，不会被写库。
20. **账号注销/会话删除级联已覆盖故事数据**：`tests/story-lifecycle-w07.test.mjs:124-149` 断言 run/turn/event/checkpoint/share 归零，含进行中租约与 activeTurnId 槽。

## 未能确认

1. **撤回后对读者的真实 404 行为（问题 3 的核心）**：仓库内不存在读者读取路径（无 GET share 路由、无公开页引用），无法用代码证明「WITHDRAWN→404」。缺的是读者端读取服务与其集成测试；见 S6。
2. **分享「只暴露公开模板」**：分享记录未存任何模板字段，读者渲染时的白名单尚未实现，无法核对；需等读者入口落地后复核。
3. **S2 的可观测性**：`executeStoryTurn` 的预检查在他人 runId 下是否真的可能返回 409，取决于 `StoryTurn.runId_requestId` 唯一键下他人 run 是否存在同 requestId 的行——结构上必须由攻击者猜到目标 run 的 requestId 才能命中 committed/terminal 分支；in-progress/conflict 分支的命中条件未用运行验证（按要求未跑测试），只能确认「授权晚于读取」这一代码事实。
4. **S9 的实际可利用性**：需要故事会话的 `replaceMessageReply` 路径被重新开放；当前 `chat-application-service.ts:24` 一律 409 拦截，故无法构造现网链路。
5. 本机 `read`/`grep` 工具在复核后段持续返回工具层错误（非代码问题），第 8-20 项的行号由本地文件读取器二次核对，未见偏差；但若有后续复核者需完整的静态检索证据，应重新跑一遍 `grep` 覆盖 `src/lib/stories/**` 全量。
