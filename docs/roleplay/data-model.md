# 第一阶段数据模型与迁移

本页全为拟变更，P1-01a不需要迁移。Prisma主文件仍为database/schema.prisma；SQLite以String保存JSON，由contracts严格校验，禁止直接把客户端JSON当数据库指令。新字段遵循现有camelCase + snake_case @map，表用@@map。已有审计、上传、计费、关系、事实、修订表复用，不复制第二套。

## 共通规则

新实体id:String @id @default(cuid())；createdAt:DateTime @default(now())；可编辑实体updatedAt:DateTime @updatedAt及version:Int @default(0)。用户关联onDelete:Cascade；历史引用使用Restrict或SetNull明确处理。CAS写入条件id+owner+version，成功version+1，零行返回VERSION_CONFLICT。JSON包含schemaVersion:1；服务端校验数组数量、文本长度、枚举、范围。日期统一UTC持久化，宏使用请求冻结时间。每个新增关系同步补Prisma反向关系。

## 修改现有表

|表.字段|Prisma类型/默认|含义与约束|索引/兼容|
|---|---|---|---|
|AiModel.contextWindowTokens|Int?，null|服务端硬窗口；null表示未配置，新编排禁止宣称精确可用预算|旧模型仍沿用旧链；启用新链前配置正数|
|AiModel.tokenizerKey|String?，null|允许列表中的计数器名|未知标estimated，不能伪称模型原生|
|AiModel.generationCapabilitiesJson|String @default("{}")|schemaVersion、supportedParams、rolePolicy、stop支持、参数min/max|与model.version共同CAS|
|Conversation.promptPresetRevisionId|String?，null|绑定不可变PromptPresetRevision|FK SetNull；仅允许本人预设或公开平台模板|
|Conversation.generationOverridesJson|String @default("{}")|用户temperature/topP等覆盖；能力校验|不允许密钥/baseUrl/价格字段|
|Conversation.importMetadataJson|String @default("{}")|原格式、未知metadata、原创建时间等|不将导入来源计为可信业务状态|
|Message.importMetadataJson|String @default("{}")|原send_date、unknown字段、外部附件说明|导出保留，渲染不执行HTML|
|Message.rawContent|String?，null|新链输入/输出变换前原文|旧数据null按content显示；不会改旧账单摘要|
|MessageVersion.rawContent|String?，null|该候选的变换前内容|selectedVersion切换同步rawContent|
|MessageVersion.transformSnapshotJson|String @default("{}")|规则id/version/stage/digest及结果摘要|不含密钥；历史不受后续规则修改追改|
|ConversationContextUse.operation|String @default("CHAT")|CHAT/SUGGESTIONS/REVISION/STORY|现有唯一(conversationId,requestId)迁为三元组；已有行回填CHAT|
|ConversationContextUse.compilerVersion|String?，null|编译版本|旧sourcesJson仍可读|
|ConversationContextUse.snapshotJson|String?，null|块来源/版本、顺序、token计数质量、裁剪原因、参数与摘要|用户接口脱敏；不默认保存系统明文/密钥|
|WorldbookEntry.constant|Boolean @default(false)|常驻|旧行为不变|
|WorldbookEntry.secondaryKeysJson|String @default("[]")|次级词数组|空数组禁用次级判断|
|WorldbookEntry.secondaryLogic|String @default("AND_ANY")|AND_ANY/AND_ALL/NOT_ANY/NOT_ALL|由应用校验枚举|
|WorldbookEntry.matchMode|String @default("LITERAL")|LITERAL/REGEX|旧keywordsJson解释不变|
|WorldbookEntry.caseSensitive|Boolean @default(false)|大小写|保持旧不敏感行为|
|WorldbookEntry.wholeWord|Boolean @default(false)|Unicode词边界|中文按定义的边界规则测试，不能用ASCII \b冒充|
|WorldbookEntry.scanDepth|Int?，null|null继承书/会话扫描范围；0仅当前输入；正数最近N条有效历史+输入|不扫描contextIncluded=false|
|WorldbookEntry.position|String @default("BEFORE_HISTORY")|BEFORE_HISTORY/AFTER_HISTORY|深度插入留第二阶段|
|WorldbookEntry.role|String @default("system")|system/user/assistant|受模型rolePolicy约束|
|WorldbookEntry.sourceUid|String?，null|上游uid，作为来源不能当本地ID|@@index([worldbookId,sourceUid])；导入检查同书重复uid|
|WorldbookEntry.extensionsJson|String @default("{}")|未知字段保留|任何不支持的活跃规则需警告/阻止激活|
|WorldbookEntry.version|Int @default(0)|单条CAS|写入同时提升所属书version|
|Worldbook.extensionsJson|String @default("{}")|书级未知字段与导入设定|不直接执行|

Existing Character、UserPersona基础字段保留，避免一次把ST字段塞入公开Character响应。Persona头像/默认身份/自动绑定第二阶段再迁移。Worldbook.priority沿用高值先处理；ST order转换须显式映射，不能原数照抄假定语义一致。

## 新表：CharacterRoleplayProfile

一对一扩展，归characters域：

|字段|类型/默认|约束|
|---|---|---|
|id|String cuid|主键|
|characterId|String @unique|FK Character Cascade|
|description|String @default("")|V2 description原语义，映射原background须预览|
|exampleDialogue|String @default("")|mes_example，解析后仍保留原文本|
|systemPrompt|String @default("")|卡system_prompt|
|postHistoryInstructions|String @default("")|卡post_history_instructions|
|alternateGreetingsJson|String @default("[]")|有序字符串数组|
|creatorNotes|String @default("")|作者备注，不默认进入提示|
|cardCreator|String @default("")|卡creator，不覆盖平台creatorId|
|cardVersion|String @default("")|卡character_version|
|sourceSpec/sourceSpecVersion|String? / String?|原格式与版本|
|extensionsJson|String @default("{}")|未知data.extensions，纯数据|
|sourceDataJson|String @default("{}")|未知顶层/data字段；不重复存PNG二进制|
|version/createdAt/updatedAt|共通字段|CAS|

Character现有name/personality/greeting/scenario/tags/avatar保留为主字段；导出以当前主字段覆盖原始数据的对应字段，其他未知字段回填。平台作者ID、审核、费用、模型限制和公开状态不接受卡内覆盖。多开场初次创建会话时选中并存为真实首条消息；不改变既有会话开场。

## 新表：PromptPreset 与 PromptPresetRevision

PromptPreset字段：id；ownerId:String? → User Cascade（平台模板null）；scope:String枚举USER/PLATFORM；name:String；description:String默认""；isPublished:Boolean默认false（仅平台）；version:Int默认0；createdAt/updatedAt。索引(ownerId,updatedAt,id)、(scope,isPublished)。USER必须ownerId非空，PLATFORM必须为空，服务端事务校验。私有预设不得通过公开模板列表泄露。

PromptPresetRevision字段：id；presetId:String → PromptPreset Restrict；revision:Int；schemaVersion:Int默认1；blocksJson:String；generationJson:String默认"{}"；extensionsJson:String默认"{}"；createdAt；createdBy:String?（用户删除SetNull）。唯一(presetId,revision)。修改预设创建新Revision，不修改旧Revision；Conversation指向Revision，避免后改预设悄悄改变旧会话。删除被引用预设返回409；可先归档（PromptPreset.archivedAt:DateTime?）并隐藏选择器。

blocksJson元素：id、kind（PLATFORM_POLICY/CHARACTER/PERSONA/WORLDBOOK/EXAMPLES/HISTORY/USER_INPUT/CUSTOM/POST_HISTORY）、role、enabled、position、order、content。平台策略由服务端注入，客户端不可创建或移除；每种结构性占位块有唯一性规则。generationJson只支持temperature/topP/presencePenalty/frequencyPenalty/maxOutputTokens/stop；范围取模型能力交集，不写死某供应商范围。

## 新表：RegexRule

字段：id；ownerId:String → User Cascade；name:String；scope:String USER/CHARACTER/CONVERSATION；characterId:String? → Character Cascade；conversationId:String? → Conversation Cascade；stage:String USER_INPUT/MODEL_OUTPUT/PROMPT/DISPLAY；pattern:String；flags:String默认""；replacement:String默认""；enabled:Boolean默认false；sortOrder:Int默认0；engineVersion:String；sourceDataJson:String默认"{}"；version/createdAt/updatedAt。

约束：USER两外键均空；CHARACTER仅characterId非空且本人可编辑；CONVERSATION仅conversationId非空且本人拥有。按ownerId、scope、stage、sortOrder、id查询，跨scope执行次序USER → CHARACTER → CONVERSATION，同级sortOrder/id稳定排序。不新增任意脚本字段。受限引擎不支持的表达式在保存/导入时报错；DISPLAY规则仅影响显示，不能持久化替换旧消息。

## 新表：ImportJob

字段：id；ownerId:String → User Cascade；kind:String CARD/WORLDBOOK/PRESET/REGEX/CHAT；status:String PREVIEW/CONFIRMED/EXPIRED/FAILED；assetId:String? → UploadAsset SetNull；digest:String；schemaVersion:Int默认1；reportJson:String；normalizedJson:String（预览规范化纯数据）；resultJson:String?；requestId:String；targetId:String?；targetVersion:Int?；expiresAt:DateTime；confirmedAt:DateTime?；createdAt/updatedAt。

唯一(ownerId,requestId)，索引(ownerId,status,expiresAt)。asset复用现有上传服务并绑定owner，不能公开原始文件。创建预览不创建角色/消息/收费。确认事务CAS PREVIEW → CONFIRMED，同时写实体和结果；并发/重放返回同一结果。超过上传/条目/消息限制直接拒绝，不截断后假成功。过期任务由既有worker任务框架清理临时资产，不新增setInterval。

导入任务短期保留源文件；确认后必须把需要长期无损导出的unknown字段转入目标元数据。原文件到期不会让已导入角色无法导出。digest包含字节与kind，不能仅以文件名判断重复。

## 分支修复无需新表

P1-01c在一个事务内复制message、versions、attachments、facts、bindings。映射oldMessageId → newMessageId；oldVersionId → newVersionId；selectedVersionId必须属于复制后的同一message。费用单、AiCall、分享令牌、会员使用不复制。来源消息在分叉范围外的事实不复制；sourceMessageId=null的手工事实允许复制当前值，并在响应说明不是时间点回溯。旧branch行为需补回归后再替换。

## 迁移批次

|批次|内容|前置与验证|
|---|---|---|
|M1|AiModel能力；ContextUse operation/快照|唯一约束迁移无重复丢失；原请求来源可读|
|M2|角色profile、预设/修订/绑定|旧角色无profile仍可聊；旧会话走原配置|
|M3|世界书条目与扩展字段|全部旧条目默认值保持命中与排序|
|M4|RegexRule、rawContent、变换快照|旧正文/版本逐字保留|
|M5|ImportJob与导入metadata|旧字段空对象；旧JSON导出保持可用|

每批追加时间戳迁移，先在基线临时库+代表性历史夹具升级。SQLite改唯一约束可能需建新表复制，必须核对外键和行数，事务失败可恢复。恢复策略是关闭新功能+回退兼容代码；不编写自动drop新表的生产降级。数据库实际迁移、生产备份和执行需要对应环境及授权。
