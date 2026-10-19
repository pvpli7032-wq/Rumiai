# M1 故事模块隐私与数据边界核对

> 范围：仅规划核对，不改代码。新增对象按规划书第 15 章表 14：StoryTemplate、StoryVersion、StoryRun、StoryTurn、StoryEvent、StoryCheckpoint、StoryShare。约束依据第 18、24 章；V0 不新增这些表。本文将“公开”限定为已发布模板允许字段或读者明确确认发布的分享快照。

## 1. 敏感面与字段可见范围

权限原则：模板公开字段可被访客读取；模板作者可读写自己的模板草稿/版本；StoryRun 的所有者可见实例内容；运行实例中的事件/检查点/轮次不得因使用公开模板而公开。StoryShare 只对读者公开字段白名单，创建者及模板作者不得借分享读取读者私人聊天、记忆、内部事件来源或私密备注。平台运维访问应按最小权限、审计和必要性限制。

| 对象/字段类别 | 敏感性 | 可见范围与处理 |
| --- | --- | --- |
| StoryTemplate：名称、简介、封面、标签、公开角色/场景设定、发布状态 | 按发布状态区分 | 仅已审核/已发布版本的明确白名单字段公开；草稿仅作者及获授权审核人员可见；不得把模板字段与某个 StoryRun 的私聊/关系状态混用。 |
| StoryTemplate：作者内部备注、审核材料、拒绝原因、未发布字段 | 私密/内部 | 作者自身备注仅作者及按职权获授权审核者可见；不得进入公开模板 DTO、搜索索引、分享图或访客接口。 |
| StoryVersion：版本号、locale、公开正文/资源 | 发布内容 | 已发布版本白名单可公开；未发布/编辑中的版本仅作者与授权审核人员可见。版本变更不得改写既有 StoryRun 固定使用的版本。 |
| StoryRun：userId、template/version ID、状态、revision、当前章节/进度、关系状态/数值 | 私密 | 仅该用户；作者/模板作者不得读取运行实例。API 返回按所有者授权的 DTO；不将 userId、私有状态或私聊内容放进公开链接。 |
| StoryTurn：用户/模型输入输出、消息正文、requestId、状态、错误/重试信息、消耗信息 | 高敏私密 | 仅该 StoryRun 所有者；requestId、模型提示词、密钥、供应商原始数据不能进入客户端公共 DTO/日志。错误只返回规范化信息。 |
| StoryEvent：type、status、createdAt、sourceTurnId | 私密元数据 | 属于运行实例的事件来源和历史轨迹，仅该实例所有者及受限运维流程可见；外部遥测只记必要的低基数 ID/状态/时间，不记录正文。公开分享只能使用用户确认后的显示内容，不能直接序列化事件行。 |
| StoryEvent：候选/证据正文、提取事实、承诺、关系变化、章节结果、来源消息/原文 | 高敏私密 | 仅实例所有者；尚未确认的候选不能作为事实展示或写入持久记忆。来源消息被编辑/删除后，关联事件必须同步删除、标记失效或从有效状态重建。 |
| StoryCheckpoint：摘要、结构化状态、事实/关系/承诺、生成依据、revision | 高敏私密派生数据 | 仅实例所有者及受限后台；不得供模板作者或分享接收者查看。不得把 AI 摘要视为删除原文后仍可保留的匿名数据；来源消息删除时须清理/失效并重建。 |
| StoryShare：分享 ID/token、创建者/实例关联、访问状态/时间/撤销元数据 | 私密/安全凭据 | token 必须不可猜且不能作为授权替代；创建者仅管理自己的分享；不在 URL、日志、引用链接中泄露私人实例标识。读者只可读取有效快照白名单。 |
| StoryShare：确认时快照字段 | 公开范围受限 | 仅用户预览后明确勾选并确认的字段。建议允许：公开模板/章节标题、选中对话片段、用户确认摘要、获准图片。快照固定，不自动包含后续新聊天、运行状态、来源事件、checkpoint、未选消息或备注。 |
| 私密备注（实例备注、事件注释、作者/读者注释） | 私密 | 默认不选、不渲染进分享卡、不随模板或分享快照输出；只有用户主动逐字段选择并再次确认后才可纳入，并醒目标识将公开。 |

## 2. 生命周期挂接点

### 导出

- 在 src/lib/accounts/data-export.ts 的 exportAccountData(userId) 显式投影新增数据；当前导出各段是手写 select，不能依赖 Prisma 自动发现。包括本人 StoryTemplate/StoryVersion（含草稿、发布状态及本人可导出字段）、StoryRun、StoryTurn、StoryEvent、StoryCheckpoint、StoryShare；导出结构应保留关联 ID、时间、状态与用户内容，便于理解和迁移。
- 仅导出当前用户可访问的分享管理记录及其快照；不得导出他人私聊/快照中超出本人权限的数据。导出自己的 StoryShare 不能把分享接收者账号信息带出。
- 明确导出已撤销/删除记录的范围和留存说明；密钥、会话令牌、内部提示词/供应商凭证、他人举报证据不进入归档。
- 将新增对象纳入同一 db.$transaction 快照，避免导出的 run 与 turn/event/checkpoint 不一致。

### 注销

- src/lib/accounts/closure-service.ts 的 closeAccount() 已在事务中调用领域擦除函数；在该事务内挂接故事数据擦除。删除用户拥有的 StoryRun 及其 StoryTurn/Event/Checkpoint/Share；删除或匿名化作者的模板草稿/版本，公开模板按业务决定撤回并匿名化作者关联，不得留下可回溯用户的私人备注。清理分享图片/上传文件并交由现有文件清理流程安全删除。
- 在 src/lib/conversations/privacy.ts 的 eraseAccountConversations(tx, userId) 或同事务故事隐私服务中，确保用户所有故事实例及派生状态一并擦除；不要只删 Conversation 后留下 StoryRun。
- 遵循 src/lib/community/privacy.ts 的作者内容处理边界：注销作者时不级联删除其他读者的私人故事/回复；删除/匿名化的是注销用户拥有的数据，而非让模板作者读取读者实例。
- 现有 AccountClosure 文件队列只接纳受校验上传路径。若故事分享图文件需异步清理，扩展清理登记与安全路径校验，不要把任意外部 URL 当本地文件删除。

### 会话/消息删除与编辑

- src/lib/conversations/message-service.ts：editUserMessage() 更新目标消息并删除同会话中其后的消息；deleteMessageAndFollowing() 删除目标及之后消息；replaceMessageReply() 重新生成时删除提示消息之后的回复。V1 故事消息/轮次应使用稳定顺序（时间+唯一 ID 或单调序号），不能仅按相同时间戳界定删除范围。
- 会话删除入口当前在 src/lib/conversations/privacy.ts 的 eraseAccountConversations() 使用 tx.conversation.deleteMany({ where: { userId } })；schema 中 Conversation -> Message 是 onDelete: Cascade。新增 StoryRun 必须明确与会话/所有者的关系；会话删除要删除或失效其关联 StoryRun、Turn、Event、Checkpoint、私有分享快照，不能只依赖目前的 Conversation->Message 级联。
- 对编辑/删除/重新生成影响范围内的故事轮次，事务内使其后续 StoryEvent 与 StoryCheckpoint 失效或重建；先删除/失效来源，再允许故事记忆读取。用户请求删除的消息及任何派生记忆不得继续进入提示词、导出分享或后续状态。已发布分享快照按用户明确政策处理：停止从源实例更新；删除源消息时撤销/重建包含该消息的分享并告知已下载副本无法远程撤回。
- 具体消息编辑/删除 HTTP 路由须调用 message-service.ts 对应函数，并与故事派生状态在同一事务/可靠失效流程中保持一致；当前指定文件未包含相关路由实现，落地时需查找实际入口。

### 备份与恢复

- src/lib/operations/backup-inventory.ts 的 readBackupInventory()、readBackupCatalog() 只扫描文件与 manifest 元数据，不负责枚举数据库表；新增表不能仅靠它自动出现在清单里。更新 src/lib/operations/state-backup.mjs 的 manifest/schema 验证与 src/lib/operations/* 实际状态备份/恢复流程（需实现时定位），将 SQLite 数据库及分享依赖上传文件/引用列入备份清单。
- src/lib/operations/sqlite-backup.mjs 的 backupSqliteDatabase() 通过 VACUUM INTO 做全库快照，inspectSqliteSnapshot() 检查表计数、完整性与外键，restoreSqliteDatabase() 验证计数；它会包含新增 SQLite 表，但不会验证故事对象恢复后仍遵守撤销、删除及文件引用政策。增加恢复后的故事关联/孤儿/分享可见性与文件引用检查，并保证附件和数据库来自一致快照。
- 备份 manifest/inventory 中应列出故事表/记录计数、私有图片/附件数量与字节数、引用数、校验状态和时间，不写正文、备注、token 或可识别用户信息。恢复必须还原关系、外键和附件映射；迁移后检查所有故事表、级联关系及失效/删除状态。
- 规划书第 24 章明确“备份恢复覆盖新增数据”，所以只靠全库文件拷贝而不做附件清点与恢复验证不足以满足要求。

## 3. 跨用户访问红线：标识猜测与状态码

所有 /api/story-runs 路由和相关服务必须先认证，再通过数据库中资源所属用户授权；不能以 runId/eventId/shareId 不易猜测作为访问控制。任何查询子资源都必须在同一查询或事务中约束父级 StoryRun.userId = authenticatedUserId，禁止先按 eventId 读取内容后再漏做授权。

| 场景 | 要求与响应 |
| --- | --- |
| 未登录访问 run/event/share 管理接口 | 401；在任何资源存在性查询之前完成认证。 |
| 已登录但对他人 run/event/checkpoint/turn 无权限 | 403，符合第 18 章“权限”约定；不返回内容、所属用户名、模板私有字段或是否存在的额外信息。若具体端点采用防枚举策略统一返回 404，必须全站一致并经 API 合同确认，禁止状态码差异暴露资源存在性。 |
| 不存在/已删除/已撤销资源，或 event 不属于给定 run | 404；查询按 id + runId + userId 约束，避免 IDOR。不得将不匹配 eventId 的结果当正常空内容。 |
| expectedRevision 冲突、重复写入冲突 | 409；在已校验所有权后返回可安全重试的冲突结果，不携带他人当前内容。写操作须校验 revision 与实例所有权同事务进行。 |
| 非法输入、字段越权、模板/事件引用不匹配 | 422；只接受 DTO 白名单，拒绝客户端伪造 userId、sourceTurnId、确认状态、作者权限或内部字段。 |
| 超出请求/生成/分享速率或资源额度 | 429；按用户/实例/端点限流，响应不泄露其他用户用量。 |
| 故事服务/队列/模型不可用 | 503；不返回堆栈、提示词、数据库内容或内部凭证。 |

必须设置所有权校验的具体位置：

1. API route 认证层：规划新增 src/app/api/story-runs/**/route.ts 先验证会话，再将身份 userId 传给服务；永不信任请求体 userId。
2. 服务读写层：新增 src/lib/stories/* 服务中每个 run/turn/event/checkpoint 查询和 mutation 都执行 run 所有权约束；子资源验证 event.runId、turn.runId、checkpoint.runId 与父 run 一致。
3. 分享创建/撤销层：校验创建者拥有 run，分享快照只由服务器从已确认字段生成；防止提交任意 userId/runId/字段。
4. 分享读取层：只通过不可猜的 share token 找到有效快照，并按撤销/过期状态校验；不以 runId 或 eventId 作为公开读取凭证，不连表返回原始私聊或当前 run 状态。存储 token 应使用不可逆摘要并限制范围/时效。
5. 分享卡预览/导出/图片生成层：每次均校验创建者对 share 的所有权；预览内容、最终导出必须是同一份白名单快照，确认后再发布。
6. 删除、导出、注销与管理后台：均按用户 owner 过滤；后台访问有单独权限和审计，不可让模板作者查看读者实例。
7. 统一错误映射与速率限制：按第 18 章 401/403/404/409/422/429/503 合同执行；对猜测 run/event/share ID 的失败路径均不得返回正文、元数据侧信道或高差异响应时间。

## 4. 分享卡特有风险与要求

- 预览/发布确认前明确告知：导出的图片会复制到他人设备、截图或第三方平台，平台无法远程撤回或保证副本被删除；撤销链接只阻止后续在线访问，不会删除已下载副本。不可写成“可完全撤回/永久删除所有副本”。
- 所有私密备注、私人聊天、来源消息、未确认事件/候选、checkpoint、关系状态、模型提示词及用户标识默认不勾选，默认不进入预览和成品。私密备注不得因“全选”隐式包含；若允许纳入必须独立、明确、默认关闭并再次确认。
- 服务端字段白名单（初始建议）：templatePublicTitle、templatePublicCover、chapterPublicTitle、selectedExcerpt[]、userApprovedSummary、approvedImageAssetIds[]、locale。每项取值需来自公开模板或用户预览确认的快照；不接受客户端传入渲染任意私有字段。
- 永不白名单：userId、runId、conversationId、turnId、eventId、checkpointId、sourceTurnId、私聊全文、私密备注、原始 AI 输入/输出、未确认事件、原始上传路径、内部 moderation/审核备注、token、模型/密钥/供应商调试信息。
- 图片元数据要清除 EXIF/GPS/设备信息；限制格式/尺寸/数量和文件体积；通过受控上传/渲染生成 JPG/PNG/WebP。不得直接把私有源图片永久公开或暴露可猜路径。
- 快照记录确认时间、白名单版本与撤销状态，不保存超出纠纷处理需要的正文副本；保留期和删除策略需由产品/隐私负责人明确。分享页面不展示作者无法获知的读者私人互动/聊天。

## 5. 已知缺口与实现 Checklist

- [ ] src/lib/accounts/data-export.ts：手写查询/字段投影，新表不会自动导出；新增七类对象及关联边界测试。
- [ ] src/lib/accounts/closure-service.ts：注销显式调用擦除函数且非简单删除 User；新增故事擦除、匿名化与事务边界，处理并发写入与注销后迟到任务。
- [ ] src/lib/conversations/privacy.ts：只删除用户 Conversation 并返回 message 图片；扩展故事实例及派生状态清理，验证会话删除不遗留 StoryRun。
- [ ] src/lib/conversations/message-service.ts：编辑、删除、重新生成均按 createdAt 切后续消息；无故事派生记录联动，且同一时间戳顺序不确定。实现稳定序号、revision 与事务内派生状态失效/重建。
- [ ] src/lib/uploads/privacy.ts：hasSurvivingReference() 的关联表列表是手写的；新分享/模板资产引用图片时新增引用计数/清理逻辑，防止误删仍使用资源或留下孤儿文件。
- [ ] src/lib/community/privacy.ts：注销社区内容按作者选择性清空以保护其他用户内容；分享副本/模板作者字段须明确撤回、匿名化和引用清理策略，不能错误级联删除他人私聊。
- [ ] src/lib/operations/backup-inventory.ts：inventory 只列文件与 manifest 摘要，不枚举表/故事数据；扩展 manifest 校验、故事计数与分享附件/引用完整性。
- [ ] src/lib/operations/sqlite-backup.mjs：全库快照和通用计数不等于隐私正确恢复；补故事外键、附件一致性、失效记录及撤销分享的恢复验证。
- [ ] src/lib/operations/state-backup.mjs 与实际 state backup/restore 入口：需定位后明确纳入 Story 表与附件，新增 manifest 字段兼容/验证；readBackupCatalog() 不能单独证明备份可恢复。
- [ ] prisma/schema.prisma：新增模型需显式 owner/run/session 外键、onDelete、级联/Restrict 策略和访问查询索引；建议索引至少覆盖 StoryRun(userId, updatedAt)、StoryEvent(runId, status)、StoryTurn(runId, status, updatedAt)、StoryTemplate(status)、StoryVersion(locale)（与规划书第 15 章一致）。审查跨用户 FK 孤儿/误级联；StoryShare 快照与源 run 生命周期策略须显式建模。
- [ ] 新增故事 API 路由和服务（当前尚不存在）：逐 endpoint 验证 userId 来源、父子归属、share token 摘要/撤销、输入白名单、状态码映射和限流；覆盖猜测其他用户 run/event/share ID 的集成测试。
- [ ] 新增分享预览/生成/下载：默认不含备注；对图片副本不可撤回作发布前确认；字段白名单必须服务端执行并有快照回归测试。
- [ ] 新增派生记忆服务：明确消息编辑/删除影响 N 轮的计算、StoryEvent/Checkpoint 失效、提示词过滤与后台重建流程；保证删除原文后无旧摘要可供生成/分享。
- [ ] 迁移/恢复验收：SQLite migration、备份恢复、注销、导出、会话删除、消息编辑/删除、撤销分享及并发 turn 全链路测试覆盖七类新对象。

## 必须改动的现有文件清单

规划实现时预计必须改动以下既有文件（此外需新增故事服务/API/迁移及分享组件）：

1. src/lib/accounts/data-export.ts
2. src/lib/accounts/closure-service.ts
3. src/lib/conversations/privacy.ts
4. src/lib/conversations/message-service.ts
5. src/lib/uploads/privacy.ts
6. src/lib/community/privacy.ts
7. src/lib/operations/backup-inventory.ts
8. src/lib/operations/sqlite-backup.mjs
9. src/lib/operations/state-backup.mjs 及实际 state backup/restore 入口（实现前定位）
10. prisma/schema.prisma

以上是满足导出、注销、会话/消息删除、分享文件清理、备份恢复与访问控制的最低既有文件集；若新增上传文件引用采用独立模块，还需同步修改相应存储服务与删除任务。
