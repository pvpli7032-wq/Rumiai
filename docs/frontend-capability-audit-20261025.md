# 星伴：竞品能力对照与前后台细粒度实施规格（深化版）

> 实施更新：P0/P1实际改动、参数来源与验证结果见第18节。前17节保留扫描时的基线问题，不代表新版仍存在全部旧缺口。真实收款保持关闭；真实邮件投递仍待服务商配置。
日期：2026-10-25

> 深化版更新：在原70项能力对照基础上，增加 **148条细粒度规格**（C44、D42、A34、X28；跨组重叠能力共用实现，不代表148个独立新功能）。每条明确前台行为、后台参数来源、API现状/拟新增、数据关联、模块与验收。重点阅读第11–17节。
>
> 本轮仅定点核对GitHub和线上已有证据，不重跑全量扫描或全站测试；只更新本文件，不新增脚本/模块，不更改业务或真实收款状态。

版本基线：883a946fd5680d540b074bb9ddfe612df81288fb
仓库：pvpli7032-wq/Rumiai（私有）

## 1. 结论与范围

项目已经采用 apps/web、apps/admin、apps/api、apps/worker 与 packages/backend、contracts、ui 的模块结构，并非只有几个文件或只有页面壳。下一阶段应优先补齐现有能力的业务闭环与聊天体验，而非为目录漂亮再拆一遍，也不应将所有竞品功能照搬。

本次从获授权的线上宝塔项目读取代码，并与 GitHub 提交核对；后续分析不使用本地工作区。线上 current 指向 releases/mobile-flow-20261025，HEAD 与 GitHub 相同；检查开始时 git status --short 无输出。目录盘点覆盖 1057 个指定类型文件，内存读取约 969 个源码/配置文件；架构工具实际检查 912 个源文件。文件读取与检索不等于逐行人工审阅，更不等于所有按钮已经实测。

本报告包含全量接口目录、业务模块盘点以及 70 项功能对照。重点对聊天、记忆、引导、分享、会员与账号恢复追踪了实际调用代码。其他领域明确标记代码存在或待验收，没有把“有接口”写成“线上已可用”。本轮没有修改业务代码、生产数据、支付设置，也没有真实模型消费；本次仅维护本报告。

### 当前首先处理的事项

1. P0：普通会话公开接口缺少分享授权/撤销检查；知道会话 ID 的调用方可请求最近 12 条文本。没有扫描或读取其他用户私聊，结论来自线上与 GitHub 同一份源码。
2. P1：兴趣引导的刚选标签没有驱动步骤二重新推荐；影响“选完兴趣但感觉没变化”。
3. P1：记忆确认成功后当前列表移除该事实；加载失败又会让面板消失，容易被误认为没生效。
4. P1：关系模式只保存，未进入普通聊天提示词；亲密度阈值仍明确标记为占位规则。
5. P1：阅读设置请求失败可一直显示加载，错误信息不可见。
6. P1：账号恢复存在令牌与页面，但生产邮件发送适配器未接通。
7. P1：普通聊天输入仍为单行；刷新恢复草稿、动态接话建议尚未形成完整体验。
8. 配置事实：线上会员公开目录返回 plans=[]；真实收款返回 CHECKOUT_DISABLED。前者不直接证明配置链路坏，后者是用户要求的关闭状态，不能当作故障。

## 2. 状态与优先级定义

- **已实现代码**：查到有意义的实现或调用链；不代表本轮全部实际操作通过。
- **已实现且隔离测试通过**：指定范围的测试本轮在服务器执行成功，具体覆盖见第 6 节。
- **部分实现**：有基础能力但入口、语义、生效点、错误恢复或外部服务未闭环。
- **未发现实现**：在当前缓存源码、路由和模型范围未找到完整实现；不是证明任何位置绝对不存在。
- **待验收**：不把历史测试文件存在当作本轮通过。
- **关闭/未配置**：产品状态，不能冒充开发缺陷。

P0 为隐私/权限或核心账务阻断；P1 为现有承诺兑现与核心聊天体验；P2 为有基础后的差异化增强；P3 为成本较高或需求尚需验证的可选项。P1 不意味着要同时开发所有事项。

## 3. 逐模块对照表

说明：证据链接固定到本次 GitHub 提交。目录证据指向模块范围；行号是核对入口。完整验收条件列出的工作，是后续交付标准，不是已完成声明。

### 发现与入门

| ID | 能力 | 当前状态 | 当前边界 / 缺口 | 优先级 | 完成验收 | 证据 |
|---|---|---|---|---|---|---|
| F001 | 角色搜索、类型与身份筛选 | 已实现代码 | URL保存筛选状态；不等于个性化推荐算法。需实际验证组合筛选、返回位置。 | P1 | 组合筛选、刷新、打开详情后返回均保持条件 | [apps/web/src/components/discover/use-discover-state.ts:24](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/apps/web/src/components/discover/use-discover-state.ts#L24) |
| F002 | 推荐、世界观、创作者、榜单入口 | 已实现代码 | 已有对应组件与公开API；本次未逐个交互验收。 | P2 | 每个入口对应真实数据；空榜明确显示空状态 | [apps/web/src/components/discover/discover-page.tsx](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/apps/web/src/components/discover/discover-page.tsx) |
| F003 | 兴趣引导联动推荐 | 部分实现 | 当前兴趣只在结束时保存；步骤二仍用初次GET的推荐结果，刚选择的兴趣没有重新请求推荐。 | P1 | 步骤一换兴趣后步骤二重新排序；可跳过；无角色仍可继续 | [apps/web/src/components/growth/onboarding-flow.tsx](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/apps/web/src/components/growth/onboarding-flow.tsx) |
| F004 | 角色开场白、场景建议 | 已实现代码 | 有开场白与场景静态建议；不是根据当前对话动态生成。 | P1 | 无聊天经验者进入后可直接选一句开始 | [apps/web/src/components/chat/chat-composer.tsx](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/apps/web/src/components/chat/chat-composer.tsx) |
| F005 | 动态接话建议、换一批、代写 | 未发现实现 | 现有快捷语和静态场景选项不等于AI接话；应复用上下文并独立预算。 | P1 | 生成多条可编辑建议；不自动发送、不重复收费 | [apps/web/src/components/chat/chat-composer.tsx](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/apps/web/src/components/chat/chat-composer.tsx) |
| F006 | 首次聊天漏斗分析 | 已有接口待验收 | 已有埋点与后台漏斗路由；尚未核对实际事件去重、口径和留存统计。 | P1 | 从曝光到首发、第三轮、次日回访口径明确且可复核 | [apps/api/src/app/api/analytics/funnel-events/route.ts](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/apps/api/src/app/api/analytics/funnel-events/route.ts) |

### 聊天输入

| ID | 能力 | 当前状态 | 当前边界 / 缺口 | 优先级 | 完成验收 | 证据 |
|---|---|---|---|---|---|---|
| F007 | 发送、流式回复、取消 | 已实现代码 | 有请求ID、额度、取消和结算逻辑；本次未真实调用收费模型。 | P1 | 断网、取消、重复点击各只产生应有的一笔费用 | [packages/backend/src/modules/conversations/chat-application-service.ts:77](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/packages/backend/src/modules/conversations/chat-application-service.ts#L77) |
| F008 | 普通聊天多行输入 | 部分实现 | 普通聊天仍为单行input，故事聊天已使用textarea。 | P1 | 自动增高、有高度上限；中文输入法回车不误发 | [apps/web/src/components/chat/chat-composer.tsx:108](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/apps/web/src/components/chat/chat-composer.tsx#L108) |
| F009 | 草稿刷新恢复与会话隔离 | 部分实现 | 输入保存在React状态；本模块未见持久草稿。失败保留不等于刷新恢复。 | P1 | 按账号及会话存储草稿；发送后清理；退出账号隔离 | [apps/web/src/components/chat/use-chat-turns.ts:31](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/apps/web/src/components/chat/use-chat-turns.ts#L31) |
| F010 | 快捷语管理 | 已实现代码 | 用户资料保存shortcuts，聊天可插入；完整线上回读待验。 | P2 | 增删改、刷新后保留，插入不覆盖未发文本 | [apps/web/src/components/profile/reader-preferences.tsx:41](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/apps/web/src/components/profile/reader-preferences.tsx#L41) |
| F011 | 表情与贴纸 | 已实现且隔离测试通过 | Unicode表情与贴纸目录；附件后端测试通过，不代表所有设备渲染已验。 | P2 | 贴纸存在校验、刷新可见、重复请求不重复记录 | [apps/web/src/components/chat/chat-composer.tsx](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/apps/web/src/components/chat/chat-composer.tsx) |
| F012 | 图片消息 | 已实现且隔离测试通过 | 图片上传、归属和元数据验证、保存与回放已有；不送视觉模型。 | P1 | 有效图片可回读；伪装文件、他人资源被拒绝 | [packages/backend/src/modules/conversations/attachments/attachment-service.ts](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/packages/backend/src/modules/conversations/attachments/attachment-service.ts) |
| F013 | AI识图与图片问答 | 未实现，边界已声明 | 不能把图片展示宣传成AI看图；需视觉模型协议与计费。 | P2 | AI实际接收图像；失败回退与费用说明一致 | [packages/backend/src/modules/conversations/attachments/attachment-service.ts](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/packages/backend/src/modules/conversations/attachments/attachment-service.ts) |
| F014 | 语音输入和语音消息 | 未发现实现 | AUDIO明确尚未支持；未见录音/转写链路。 | P2 | 录音权限、取消、时长、转写失败和持久播放全闭环 | [database/schema.prisma:690](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/database/schema.prisma#L690) |

### 聊天操作

| ID | 能力 | 当前状态 | 当前边界 / 缺口 | 优先级 | 完成验收 | 证据 |
|---|---|---|---|---|---|---|
| F015 | 复制、点赞、举报 | 已实现代码 | 复制失败被静默忽略；点赞和举报有独立接口。 | P1 | 剪贴板拒绝时提示；点赞刷新保留；举报可在后台处理 | [apps/web/src/components/chat/message-actions.tsx](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/apps/web/src/components/chat/message-actions.tsx) |
| F016 | 编辑用户消息并重新生成 | 已实现代码 | 会修改本人消息并删除后续内容；派生记忆/故事状态有失效处理。 | P1 | 修改前明确告知后续历史影响；数据库与上下文同步 | [packages/backend/src/modules/conversations/message-service.ts:221](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/packages/backend/src/modules/conversations/message-service.ts#L221) |
| F017 | 直接编辑AI回复 | 未实现 | 前后端仅允许编辑USER消息。 | P2 | 明确个人编辑与AI原文差别，保留审计及记忆失效 | [apps/web/src/components/chat/message-actions.tsx:89](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/apps/web/src/components/chat/message-actions.tsx#L89) |
| F018 | 重新生成 | 已实现代码 | 替换旧回复及其后续，不保留可切换的候选版本。 | P1 | 生成失败不毁原内容；成功后结算和消息一致 | [packages/backend/src/modules/conversations/message-service.ts:170](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/packages/backend/src/modules/conversations/message-service.ts#L170) |
| F019 | 回复版本切换、分支会话 | 未发现完整实现 | 故事模板版本不等于聊天回复版本；需专属消息版本/分支模型。 | P2 | 旧回复可切回；分支的历史、记忆和费用互不串线 | [database/schema.prisma](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/database/schema.prisma) |
| F020 | 删除某条及之后的消息 | 后端有、前端入口不足 | 存在删除函数及消息路由；当前MessageActions没有删除入口。 | P1 | 先说明删除范围；确认后刷新、记忆、故事衍生数据一致 | [packages/backend/src/modules/conversations/message-service.ts:251](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/packages/backend/src/modules/conversations/message-service.ts#L251) |
| F021 | 浏览器朗读 | 部分实现 | 依赖系统speechSynthesis，非角色专属声线；未见语速选择、暂停恢复。 | P2 | 有声线可用性提示，切页停止；不宣称实时语音通话 | [apps/web/src/lib/speech.ts](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/apps/web/src/lib/speech.ts) |
| F022 | 长历史分页 | 部分实现 | 主聊天有游标分页；独立历史页用完整export加载，长历史体验未统一。 | P1 | 大量消息不整页卡顿，翻页无重复遗漏 | [packages/backend/src/modules/conversations/message-service.ts:91](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/packages/backend/src/modules/conversations/message-service.ts#L91) |
| F023 | 会话搜索、归档、删除、导出 | 已实现代码 | 搜索角色名/标题，非全文搜索；JSON/TXT导出及删除已接API。 | P1 | 归档恢复和删除刷新可见；导出仅允许本人 | [apps/web/src/components/chat/chat-conversation-list.tsx:66](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/apps/web/src/components/chat/chat-conversation-list.tsx#L66) |
| F024 | 全文检索、置顶会话、自定义标题入口 | 部分/未发现完整入口 | 后端支持标题修改，列表未见完整管理入口；全文检索和置顶需另做。 | P2 | 搜索命中具体消息并定位；置顶与重命名持久化 | [apps/web/src/components/chat/chat-conversation-list.tsx](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/apps/web/src/components/chat/chat-conversation-list.tsx) |

### 记忆与人设

| ID | 能力 | 当前状态 | 当前边界 / 缺口 | 优先级 | 完成验收 | 证据 |
|---|---|---|---|---|---|---|
| F025 | 摘要及确认事实注入AI | 已实现且隔离测试通过 | 测试确认ACTIVE进入真实请求结构、INVALID不进入；使用模拟上游，未收费。 | P1 | 开关、隔离、预算裁剪、失效和故障降级符合预期 | [packages/backend/src/modules/memory/context.ts](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/packages/backend/src/modules/memory/context.ts) |
| F026 | 记忆确认、忽略、编辑、固定、删除 | 部分实现 | 后端完整操作；前端确认后过滤掉该事实，刷新前看不见已确认项。 | P1 | 确认后立即移入已生效区；刷新结果一致 | [apps/web/src/components/chat/memory-panel.tsx:54](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/apps/web/src/components/chat/memory-panel.tsx#L54) |
| F027 | 记忆加载错误及重试 | 存在缺陷 | 读失败会关闭面板，混淆功能关闭与网络失败。 | P1 | 关闭、空列表、加载失败分别显示，失败可重试 | [apps/web/src/components/chat/memory-panel.tsx:45](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/apps/web/src/components/chat/memory-panel.tsx#L45) |
| F028 | 手动添加与来源定位 | 部分实现 | 后端有createMemoryFact；当前面板未见添加/跳转来源操作。 | P2 | 创建归属验证、来源可回看；删除来源后失效 | [packages/backend/src/modules/memory/fact-service.ts:42](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/packages/backend/src/modules/memory/fact-service.ts#L42) |
| F029 | 多用户身份Persona | 未发现完整实现 | 角色扮演指引roleTemplate不是用户可管理的多身份档案。 | P2 | 按会话绑定身份，切换确认，实际进入提示词 | [database/schema.prisma](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/database/schema.prisma) |
| F030 | 世界书/Lorebook关键词触发 | 未发现完整实现 | 当前是会话摘要/事实；世界观目录也不等于关键词世界书。 | P2 | 触发词、优先级、预算、权限和命中记录可解释 | [packages/backend/src/modules/memory/context.ts](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/packages/backend/src/modules/memory/context.ts) |
| F031 | 关系模式影响AI | 部分实现 | 开关持久化，但普通聊天传入角色、历史、记忆，未接relationshipMode。 | P1 | 先定义模式效果，再以提示词或行为测试证明开关有效 | [packages/backend/src/modules/conversations/chat-application-service.ts:137](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/packages/backend/src/modules/conversations/chat-application-service.ts#L137) |
| F032 | 亲密度成长与关系等级 | 部分实现 | 等级阈值明确为占位值；有初值和更新字段，未找到完整成长规则与提示词消费。 | P1 | 后台统一配置、事件幂等成长、前台解释；不自行编造商业规则 | [apps/web/src/components/chat/relationship-panel.tsx:9](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/apps/web/src/components/chat/relationship-panel.tsx#L9) |
| F033 | 私人备注 | 已有保存、语义需明确 | 备注可保存；普通聊天未见注入。不可让用户误以为AI会记住这些备注。 | P1 | 明确仅自己看或定义进入AI上下文，两种用途分开 | [packages/backend/src/modules/conversations/conversation-service.ts:141](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/packages/backend/src/modules/conversations/conversation-service.ts#L141) |

### 角色与创作

| ID | 能力 | 当前状态 | 当前边界 / 缺口 | 优先级 | 完成验收 | 证据 |
|---|---|---|---|---|---|---|
| F034 | 角色详情、设定、开场、模型费用 | 已实现代码 | 已有简介、人设、背景、场景、开场及replyPlan；费用刷新和私有设定展示待验。 | P1 | 角色详情与实际可用模型/费用一致 | [apps/web/src/components/characters/character-detail-tabs.tsx:9](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/apps/web/src/components/characters/character-detail-tabs.tsx#L9) |
| F035 | 点赞收藏、评论、作者关注 | 已有接口和组件 | 评论编辑删除点赞、创作者关注已有路由；未逐项浏览器操作。 | P2 | 登录态、重复操作、自己的评论编辑删除和计数一致 | [packages/backend/src/modules/characters/engagement-service.ts](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/packages/backend/src/modules/characters/engagement-service.ts) |
| F036 | 角色创建、编辑、草稿、发布 | 已有代码链路 | 已有创作步骤和后端服务；重构后需完整走草稿→审核→公开。 | P1 | 刷新不丢草稿，非法发布拦截，审核通过可发现 | [apps/web/src/components/creator/use-creator-form.ts](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/apps/web/src/components/creator/use-creator-form.ts) |
| F037 | 角色任务与奖励 | 已有代码链路 | 任务进度与领取资格有实现；不是通用视觉剧情任务编辑器。 | P2 | 未达成不能领，重复领取不重复加币 | [packages/backend/src/modules/characters/quest-service.ts](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/packages/backend/src/modules/characters/quest-service.ts) |
| F038 | 角色相册、情绪图片、配角 | 部分实现 | 已有资产/展示；配角名单不等于多人群聊，情绪图不等于实时情绪动画。 | P2 | 图片可管理、撤下后正确回显；功能命名不夸大 | [apps/web/src/components/characters/character-detail-tabs.tsx:40](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/apps/web/src/components/characters/character-detail-tabs.tsx#L40) |
| F039 | 角色卡导入导出、版本回滚 | 未发现完整实现 | 账号导出与角色卡标准导入导出不是同一功能。 | P3 | 格式校验、预览、权限、资源失败处理和版本恢复 | [packages/backend/src/modules/characters/creator-service.ts](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/packages/backend/src/modules/characters/creator-service.ts) |

### 故事与玩法

| ID | 能力 | 当前状态 | 当前边界 / 缺口 | 优先级 | 完成验收 | 证据 |
|---|---|---|---|---|---|---|
| F040 | 故事目录、回合、结束章节、继续 | 已实现代码 | 独立状态机、revision及请求ID；公开故事目录线上200。 | P1 | 完整完成章节和续章；重复提交、断线不重复扣费 | [apps/web/src/components/chat/story-mode.tsx](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/apps/web/src/components/chat/story-mode.tsx) |
| F041 | 故事状态整理和检查点 | 已有后端实现 | 有事件、检查点、重试、历史失效，不等于用户可自由存档读档。 | P1 | 工作任务失败可恢复；章节状态与显示一致 | [packages/backend/src/modules/stories/lifecycle/state-worker.ts](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/packages/backend/src/modules/stories/lifecycle/state-worker.ts) |
| F042 | 分支树、存档槽、剧情编辑器 | 未发现完整前台 | 现有章节机制可复用；不要另造一套聊天状态。 | P2 | 分支/读档不会复制计费或污染别的存档 | [apps/web/src/components/chat/story-mode.tsx](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/apps/web/src/components/chat/story-mode.tsx) |
| F043 | 评理、投票、镜像对照 | 已有独立模块 | 项目已有差异化玩法，mirror也有生成/购买/分享服务；本次未触发收费生成。 | P2 | 用户看得懂输入与结果；生成失败有恢复及费用处理 | [packages/backend/src/modules/disputes/case-service.ts](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/packages/backend/src/modules/disputes/case-service.ts) |
| F044 | 主动问候、离线消息、纪念日 | 未发现完整实现 | 站内通知不是角色主动聊天；需用户订阅、时区和频率规则。 | P2 | 明确同意、免打扰、关闭立即生效且不伪造真人在线 | [packages/backend/src/modules/notifications/service.ts](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/packages/backend/src/modules/notifications/service.ts) |
| F045 | 日记、状态、陪伴计时、一起听歌 | 未发现完整实现 | 作为可选玩法；先验证是否提升回访，不为堆功能强做。 | P3 | 每项有真实状态保存和可理解用途 | [apps/web/src/components/chat/](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/apps/web/src/components/chat/) |

### 多模态

| ID | 能力 | 当前状态 | 当前边界 / 缺口 | 优先级 | 完成验收 | 证据 |
|---|---|---|---|---|---|---|
| F046 | 角色声线、电话、实时语音 | 未发现完整实现 | 浏览器朗读不是云TTS/实时通话；需要媒体会话与独立成本预算。 | P3 | 延迟、中断、重连、时长和成本可核算 | [apps/web/src/lib/speech.ts](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/apps/web/src/lib/speech.ts) |
| F047 | AI生图、视频、动态头像 | 未发现完整实现 | 上传和静态插画不等于模型生成；先做使用需求验证。 | P3 | 真实生成任务、进度、失败、资源保存与预算完整 | [packages/backend/src/modules/uploads/](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/packages/backend/src/modules/uploads/) |

### 社交与传播

| ID | 能力 | 当前状态 | 当前边界 / 缺口 | 优先级 | 完成验收 | 证据 |
|---|---|---|---|---|---|---|
| F048 | 圈子、帖子、评论、关注、通知 | 已有代码链路 | 对应circles/posts/community/notifications；需逐项状态操作验收。 | P2 | 发帖权限、评论删除、关注通知已读和计数同步 | [apps/web/src/components/community/square-hub.tsx](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/apps/web/src/components/community/square-hub.tsx) |
| F049 | 普通聊天分享 | 存在权限缺陷 | 公开接口直接按会话ID读取最近12条；不检查分享授权/撤销，分享内容也非固定快照。 | P0 | 未分享404；只返回确认选中内容；撤销立即不可读；后续私聊不泄露 | [apps/api/src/app/api/public-conversations/[id]/route.ts:5](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/apps/api/src/app/api/public-conversations/[id]/route.ts#L5) |
| F050 | 选消息分享、分享卡、撤销中心 | 未完整实现 | 现有普通分享返回会话链接；应统一授权快照而不是新增另一套裸链接。 | P1 | 预览、选条、脱敏、快照、撤销贯通 | [apps/web/src/components/chat/chat-share-dispute.tsx](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/apps/web/src/components/chat/chat-share-dispute.tsx) |
| F051 | 举报、申诉与审核 | 已有接口和模块 | 有后台队列与申诉接口；本次未提交实际举报。 | P1 | 报告可追踪处理结果，越权处理被拒绝 | [apps/web/src/components/moderation/my-reports.tsx](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/apps/web/src/components/moderation/my-reports.tsx) |

### 账号与偏好

| ID | 能力 | 当前状态 | 当前边界 / 缺口 | 优先级 | 完成验收 | 证据 |
|---|---|---|---|---|---|---|
| F052 | 资料修改、资产页、账号导出注销 | 已有代码链路 | 有账号资产集成测试文件；本次未修改真实账号，不标记已实测。 | P1 | 昵称头像刷新一致；金币会员来源可追踪；注销不遗漏关联 | [packages/backend/src/modules/accounts/profile-service.ts](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/packages/backend/src/modules/accounts/profile-service.ts) |
| F053 | 阅读模式、屏蔽词 | 部分实现 | 屏蔽词是显示折叠；加载失败loaded未置true，错误被加载分支遮住。 | P1 | 失败能看到提示并重试；阅读偏好刷新生效 | [apps/web/src/components/profile/reader-preferences.tsx:26](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/apps/web/src/components/profile/reader-preferences.tsx#L26) |
| F054 | 邮箱验证、找回密码、激活 | 部分实现 | 令牌/路由已有；生产不支持实际发信，目前仅开发memory outbox。 | P1 | 真实邮箱收信、单次令牌、到期、重发限流和成功登录 | [packages/backend/src/infrastructure/email/account-email-delivery.ts:18](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/packages/backend/src/infrastructure/email/account-email-delivery.ts#L18) |
| F055 | 主题、移动导航、抽屉 | 已实现代码 | 已有焦点圈定、Escape、滚动锁、移动底部面板；需真机键盘和返回手势回归。 | P1 | 打开键盘不遮发送区；返回恢复列表位置；抽屉可键盘关闭 | [apps/web/src/components/chat/chat-panel-sheet.tsx](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/apps/web/src/components/chat/chat-panel-sheet.tsx) |

### 会员与财务

| ID | 能力 | 当前状态 | 当前边界 / 缺口 | 优先级 | 完成验收 | 证据 |
|---|---|---|---|---|---|---|
| F056 | 会员套餐后台配置→前台 | 已实现代码，线上无可售套餐 | 线上GET会员目录plans为空；不能据此认定链路坏，也不能称已可购买。 | P1 | 已配置且启用套餐前台准确显示；下架不影响历史订单 | [packages/backend/src/modules/memberships/service.ts:49](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/packages/backend/src/modules/memberships/service.ts#L49) |
| F057 | 价格、周期、权益订单快照 | 已实现代码 | 订单保存价格、天数、权益和退款参数；未进行真实支付。 | P1 | 改价不改老订单；后台与前台单位一致 | [packages/backend/src/modules/memberships/service.ts:178](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/packages/backend/src/modules/memberships/service.ts#L178) |
| F058 | 支付后生效、手动续费 | 已实现代码 | 按24小时天数计算；重复回调不重复延长，有效会员后顺延。 | P1 | 未支付不生效；到期失效；续费与回调幂等 | [packages/backend/src/modules/memberships/service.ts:190](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/packages/backend/src/modules/memberships/service.ts#L190) |
| F059 | 24小时退款及使用权益计费 | 已实现代码，待本轮业务验收 | 已有使用记录/退款预估；本次只读公开政策24h/24h，不声称真退款验证。 | P1 | 未用全退、用过按政策扣；边界时间、在途权益、重复退款全验 | [packages/backend/src/modules/memberships/service.ts:238](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/packages/backend/src/modules/memberships/service.ts#L238) |
| F060 | 真实权益与装饰文案区分 | 已有受限权益模型 | 只允许已支持的权益代码；金币包benefits是描述字符串，不自动赋予功能。 | P1 | 每项售卖权益能定位实际消费点及退款使用记录 | [packages/backend/src/modules/memberships/service.ts:13](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/packages/backend/src/modules/memberships/service.ts#L13) |
| F061 | 金币套餐、订单、账本 | 已有代码，收款关闭 | 线上header明确CHECKOUT_DISABLED，保持关闭；账本和订单需登录验收。 | P1 | 余额以账本为准；失败/重放/退款不重复增减 | [apps/api/src/app/api/coins/packages/route.ts](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/apps/api/src/app/api/coins/packages/route.ts) |
| F062 | 邀请和返佣 | 部分实现 | 邀请关系和返佣记账已有；没有实际提现打款闭环，不能宣传可提现。 | P2 | 订单退款反冲；关系不可随意篡改；打款另行设计 | [packages/backend/src/modules/affiliate/service.ts](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/packages/backend/src/modules/affiliate/service.ts) |

### 运营与后台

| ID | 能力 | 当前状态 | 当前边界 / 缺口 | 优先级 | 完成验收 | 证据 |
|---|---|---|---|---|---|---|
| F063 | 独立管理登录和权限 | 已有独立模块 | apps/admin与专属登录/session/roles接口存在；本次未登录业务后台验收。 | P1 | 前台令牌不能直接当后台会话，角色权限实际拒绝越权 | [packages/backend/src/modules/admin-auth/service.ts](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/packages/backend/src/modules/admin-auth/service.ts) |
| F064 | 用户详情与资料/资产联动 | 已有接口和模块 | 账号详情、profile、settings有独立接口；仍需真实UI修改/回读。 | P1 | 后台修改前台即时回读，会员/金币/封禁来源可核对 | [packages/backend/src/modules/accounts/admin-profile-service.ts](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/packages/backend/src/modules/accounts/admin-profile-service.ts) |
| F065 | AI供应商、模型删除 | 已有删除路由待重验 | 已有lifecycle-delete测试；不能仅凭按钮存在判定本轮可用。 | P1 | 可删项真实删除；有引用项解释阻止或停用，不假成功 | [apps/api/src/app/api/admin/ai/providers/[id]/route.ts](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/apps/api/src/app/api/admin/ai/providers/[id]/route.ts) |
| F066 | 设置分组、版本与历史 | 已有模块和测试 | registry、public-keys、overrides及历史恢复接口已有。 | P1 | 后台配置发布后实际被消费；冲突版本拒绝；敏感键不公开 | [packages/backend/src/modules/settings/service.ts](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/packages/backend/src/modules/settings/service.ts) |
| F067 | 签到、任务、礼物模块 | 已有受控模块 | 固定模块registry；不是任意插件市场，不需要为了结构建空plugins目录。 | P2 | 关闭后后端也阻止；历史保留；奖励幂等 | [packages/backend/src/modules/growth/](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/packages/backend/src/modules/growth/) |
| F068 | CMS、公告、导航及内容版本 | 已有接口和组件 | 有内容修订、恢复与前台投影；逐类发布/下架待验。 | P2 | 草稿不公开；发布时间、撤下、恢复前后台一致 | [apps/api/src/app/api/admin/site-content/[type]/[id]/revisions/route.ts](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/apps/api/src/app/api/admin/site-content/[type]/[id]/revisions/route.ts) |
| F069 | 任务、费用、审计与运行状态 | 已有模块和路由 | 运行记录/成本/审计已有；本次未手动执行线上任务。 | P1 | 失败信息可见，重复运行受控；模型成本与用户费用区分 | [apps/api/src/app/api/admin/tasks/[id]/run/route.ts](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/apps/api/src/app/api/admin/tasks/[id]/run/route.ts) |

### 工程结构

| ID | 能力 | 当前状态 | 当前边界 / 缺口 | 优先级 | 完成验收 | 证据 |
|---|---|---|---|---|---|---|
| F070 | 前端/后台/API/worker分层 | 已检查通过 | 线上检查912个源文件通过；功能正确性不能由分层检查代替。 | P1 | 新增功能遵守模块边界，不在页面直接连数据库 | [ops/architecture/check-boundaries.mjs](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/ops/architecture/check-boundaries.mjs) |

## 4. 已确认问题的处理规格

### I01：普通会话分享缺乏授权状态（P0）

证据：apps/api/src/app/api/conversations/[id]/share/route.ts 生成会话 ID 链接，但没有持久化分享授权；public-conversations/[id]/route.ts 直接查会话并返回最近 12 条，没有 requireUser 或分享状态判断。Cache-Control: private 不构成授权控制。GitHub 单文件核对与线上一致。

应改为独立的授权分享记录：随机分享标识、拥有者、会话、选定消息快照、撤销状态；创建时展示预览和范围，公开读取只读快照。不自动公开将来新增消息。复用现有故事分享领域经验，但先核对模型语义，不直接把普通会话强塞进 StoryShare。
验收：未创建分享不可读；别人的会话不可创建；撤销后不可读；以后继续聊天不改变公开快照；删除/编辑原消息后的公开策略明确；不存在的分享返回统一结果。
本轮未更改该接口，需作为首个修复任务。

### I02：新手兴趣选择与推荐脱节（P1）

OnboardingFlow 初次 GET 取得 payload.recommended；toggleInterest 只改本地状态；finish 才 POST 保存。第二步直接渲染旧 payload.recommended。后端 readOnboarding 依据数据库中已有 interests 评分，因此首次选择尚未生效。
改法：增加非完成式推荐查询，或单独保存兴趣再取推荐；不能为了刷新推荐提前标记整个引导完成。
验收：用两组可区分标签的固定角色数据验证排序变化；回上一步再改也生效；跳过仍可进入产品。

### I03：记忆面板成功与失败表现错误（P1）

确认接口返回 ACTIVE 事实，但面板 act 成功统一 filter 掉当前项；确认后应更新状态或重新获取列表。读取失败设置 enabled=false，会将故障误表现为功能不存在。
验收：确认后出现在已生效区域；忽略/删除才移除；确认失败保留原项；网络故障显示重试；功能关闭与空列表独立显示。

### I04：关系模式和成长指标缺少实际消费（P1）

conversation-service 允许保存 relationshipMode、romance、intimacy；relationship-panel 的等级阈值注释明确“占位”。普通聊天 executeChatTurn 传给 streamOpenAIResponse 的是角色、历史、内容、模型与 memoryContext，没有消费会话关系模式。不要因数据库能保存就宣布模式会影响角色。
应先明确模式含义与成长事件，再由 conversations 领域形成上下文，contracts 定义可配置规则，后台统一配置；前台只显示规则投影。没有规则前不要包装成已完成的养成系统。
验收用固定输入检查真实发往模型的请求结构，而不是看按钮颜色变了。成长事件幂等、防重复奖励、跨会话作用域均要明确。备注目前可作为私用笔记，不应默认承诺AI记得。

### I05：阅读设置错误被加载状态遮挡（P1）

reader-preferences.tsx：非200响应返回 null，导致 loaded 一直 false；异常只 setError，组件的 !loaded 分支先 return spinner，错误区域无法显示。
改法：显式 loading/error/data 状态，finally 结束 loading，失败入口支持重试。文案“设置载失败”同步修正。
验收：200、401、500、断网四种响应；不会无限转圈，不展示假成功。

### I06：生产账号邮件不可达（P1）

account-email-delivery.ts 只在非 production 且 ACCOUNT_EMAIL_DELIVERY=memory 时提供内存投递。其他情况抛出未配置错误。开发令牌测试通过不能替代真实邮箱投递。
需要正式邮件适配器、配置可用性检查、模板与可用站点链接；继续保持令牌不写日志。验收包括发信失败、过期、一次性使用和重发。未配置时明确不可用，比假称已发送正确，但尚不是完整生产功能。

### I07：聊天细节需统一（P1/P2）

普通单行输入、草稿仅内存、剪贴板失败静默、独立历史页整段导出渲染，以及缺少消息删除入口，是不同规模的问题，应分别验收。不要以一轮CSS刷新宣称全部修好。普通重生成会替换历史，不是回复多版本；为版本切换增模型前先定义分支与记忆的关系。

## 5. 结构规划和开发顺序

### 模块归属

| 领域 | 前台 | 后台 | 服务端归属 | 共享契约与数据 |
|---|---|---|---|---|
| 发现/新手体验 | components/discover、growth | 标签、CMS、增长配置 | discovery、growth、characters | contracts；兴趣与推荐查询 |
| 聊天/消息/草稿 | components/chat；lib/conversations | 聊天规则与计费配置 | conversations；跨域调用放 workflows | 消息、回合、分支契约；草稿按账号会话隔离 |
| 记忆/身份/世界书 | chat 记忆面板 | 记忆预算及开关 | memory；身份领域达到规模后独立模块 | MemoryFact/ConversationMemory；新结构经迁移 |
| 角色/创作 | components/characters、creator | 角色审核与资产 | characters、creators、uploads | 角色契约，发布状态和资源归属 |
| 故事 | components/stories、chat/story-mode | 模板发布与任务观测 | stories；工作任务 apps/worker | StoryRun/Turn/Checkpoint；复用现有revision |
| 分享/社交 | chat分享、community、notifications | 审核、申诉 | conversations分享边界、community、notifications | 授权分享快照；不复用裸会话ID当授权 |
| 会员/金币/退款 | memberships、shop | memberships、finance | memberships、billing、payments、coins | 订单快照、使用记录、账本 |
| 邮件/账户恢复 | auth、profile | 账号/邮件可用性 | accounts；外部邮件 infrastructure/email | 一次性令牌契约，不向UI暴露密钥 |
| 语音/视觉（后续） | chat媒体控件 | 供应商、能力、预算 | ai适配器、uploads；成熟后独立媒体领域 | 新媒体状态与独立费用，不能只扩按钮 |

沿用现有路由薄层 → 领域服务 → 基础设施方向。UI通过HTTP，不直接引用数据库。通用交互放 packages/ui；业务组件归各自应用。无需无业务依据地创建空 plugins、features 等目录。

### 分阶段计划

**阶段 A：兑现现有承诺。** 先 I01；随后 I02–I06，以及实际删除入口、错误恢复、后台配置消费核对。对账务相关功能先验证幂等和退款，真实收款继续关闭。
退出条件：已知缺陷有复现、修复和回归记录；没有“按钮变了但服务器没变”的结果。

**阶段 B：让人容易开始并继续聊天。** 多行输入、分会话草稿、可编辑的接话建议、清晰模型费用、首聊入口；完善记忆面板与长历史。观察首次发言、第三轮完成和次日回访，不把功能数量当成功指标。
退出条件：新用户不需要自己想开场话题；弱网可恢复；不会误发或重复扣费。

**阶段 C：增加可持续内容深度。** 用户身份、回复版本/分支、世界书、故事分支、分享卡及撤销中心。先设计数据关系，再开发UI。不要将同一段对话同时维护两套事实来源。
依赖：消息版本 → 记忆失效/分支隔离 → 分享快照；先做好再扩玩法。

**阶段 D：按用户行为验证高成本功能。** 语音转写 → 角色TTS → 实时通话按顺序评估；AI生图/视频和日记陪伴玩法独立试点。只有真实可消费的能力才允许列为售卖权益。
没有确定价格、成长阈值、提现政策的事项，不在实现时自行填数字。

### 每个功能的“真正完成”标准

1. 入口明确，加载、空态、权限不足、失败、成功均有真实反馈。
2. API校验与权限在服务器执行；实际调用领域服务并持久化。
3. 刷新、重新登录及另一个账号的验证证明数据生效且隔离。
4. 如果承诺影响AI，必须检查实际请求上下文；如果承诺权益，必须检查真实消费点与使用记录。
5. 收费能力验证重复提交、取消、失败回滚、退款与账本；不以toast代替结算。
6. 后台参数有类型、版本、范围，前台读同一投影；不另写一套硬编码值。
7. 移动端实际点击、键盘弹出、返回、长内容和弱网各有证据。
8. 报告记录环境、提交、账号类型、操作步骤、预期、结果；未执行的明确写未执行。

## 6. 本轮实际验证记录

| 项目 | 方法 | 结果 | 能证明 / 不能证明 |
|---|---|---|---|
| 宝塔访问 | HTTPS登录 | 成功 | 具有授权远程操作通道；未更改SSH |
| GitHub与线上 | HEAD及公开分享源码核对 | 同一883a946提交；开始时工作树干净 | 当前基线一致；不代表所有服务进程构建完全一致 |
| 架构边界 | 服务器 node ops/architecture/check-boundaries.mjs | PASS，912源文件 | 应用隔离/共享契约/客户端边界；不证明业务正确 |
| 图片附件 | 服务器隔离数据库集成测试 | 1通过 | 归属、元数据、持久化、重复请求；不证明视觉AI |
| 记忆注入 | 服务器隔离数据库+模拟上游 | 1通过 | 已确认事实进入上游请求结构，失效事实不进入；不评价模型回复质量 |
| 公开金币目录 | GET /api/coins/packages | 200；X-Checkout-Enabled=false；CHECKOUT_DISABLED | 实际收款关闭；未发起支付 |
| 会员公开目录 | GET /api/memberships | 200；plans=[]；退款窗口24、计费周期24小时 | 当前无可售公开套餐；原因可能停用/未定价，未读取私有配置推断 |
| 故事目录 | GET /api/stories | 200，有故事 | 目录有真实返回；未完成整个剧情 |
| 角色目录 | GET /api/characters | 200，有角色 | 公开数据可读；未逐个角色聊天 |
| 运营状态 | GET /api/operations/status | 200，enabled=false | 返回带维护文案但开关false；不能因文案判断正在维护 |

测试命令：env -u DATABASE_URL node --import tsx --test tests/integration/chat-memory-injection.test.ts tests/integration/chat-media.test.ts。
结果：tests=2、pass=2、fail=0、skip=0，约25.3秒。测试使用服务器临时SQLite及模拟上游，没有调用收费模型，没有改实际用户数据。
未执行：业务后台逐按钮浏览器验收、真实支付退款、真实邮件投递、多设备语音、所有故事分支、真实用户资料写入。历史测试脚本仅是后续可复用资产，不能算本轮通过。

## 7. 后续逐项验收队列

| 批次 | 真实操作 | 需要的记录 |
|---|---|---|
| A | 创建独立测试会话→未分享读取拒绝→选条分享→撤销 | 权限、响应及快照；不用其他用户私聊验证 |
| B | 两组兴趣→推荐改变→开始聊天→动态建议/草稿恢复 | 请求参数、推荐列表、首聊事件 |
| C | 提出记忆→确认→固定→下一轮注入→编辑来源→失效 | 面板状态与实际模型请求结构 |
| D | 用户资料→后台修改→前台回读；禁用→访问拒绝 | 同一测试账号前后台结果 |
| E | AI供应商/模型新增停用删除、有引用阻止 | 数据行、关联解释、刷新状态；不调用真实计费测试接口 |
| F | 会员配置→前台读取→隔离支付回调→权益使用→退款预估 | 参数版本、订单快照、费用边界；真实收款关闭 |
| G | 故事创建→回合重试→章节完成→继续→历史失效 | revision、任务结果、消息和状态 |
| H | 评论/帖子/关注/举报/申诉→后台处理→通知已读 | 权限、计数、可见性、处理结果 |
| I | 找回密码真实投递与一次性验证 | 发送结果和令牌状态；不保存明文令牌 |
| J | 手机键盘、返回、抽屉、长列表、弱网 | 设备/视口与可复现步骤，不只截图首页 |

## 8. 竞品参考的使用边界

以下沿用前次功能调研的官方资料作为能力模式参考；本轮没有重新对竞品全部付费账号实测。网站访问量排名不是收入排名，也不是移动端MAU，更不能证明本项目会盈利。不把成人向产品内容直接搬入目标年龄包含青少年的产品。

- Character.AI：场景入门 https://blog.character.ai/introducing-scenes-your-new-way-to-tell-stories-on-c-ai/ ；记忆 https://blog.character.ai/memory/ ；世界书 https://support.character.ai/hc/en-us/articles/52739596326811-Lorebooks
- Kindroid：聊天细节 https://kindroid.ai/v2/docs/chat-features-and-tools/ ；记忆 https://kindroid.ai/v2/docs/memory/ ；角色设定 https://kindroid.ai/v2/docs/customizing-personality/
- Chub：聊天 https://docs.chub.ai/docs/the-basics/just-chatting ；世界书 https://docs.chub.ai/docs/advanced-setups/lorebooks
- SillyTavern：角色 https://docs.sillytavern.app/usage/characters/ ；聊天 https://docs.sillytavern.app/usage/chatting/
- Nomi：新手引导 https://nomi.ai/nomi-knowledge/nomi-101-a-beginners-guide-to-getting-started-with-your-ai-companion/ ；主动消息 https://nomi.ai/updates/september-9th-update-proactive-messages/
- PolyBuzz：https://www.polybuzz.ai/faq
- Talkie：https://play.google.com/store/apps/details?id=com.weaver.app.prod
- 猫箱：https://apps.apple.com/cn/app/id6475000292
- 星野：https://apps.apple.com/cn/app/id6463076337
- 筑梦岛：https://h5.zhumengdao.com/
- Replika：https://help.replika.com/hc/en-us/articles/360032500052-What-is-Replika-Pro
- 调研榜单口径：https://www.aicpb.com/ai-rankings/products/ai-character-rankings/websites ；https://a16z.com/100-gen-ai-apps-7/

优先借鉴“降低开口难度、保持人物一致、让用户能纠正与控制、失败可恢复”的模式；不是复制数量最多的按钮。

## 9. 全量服务端模块盘点

下表是结构覆盖清单，不等同于每个服务已逐行审计或已实际操作。

| 模块 | 源码文件数 | 后续核对重点 |
|---|---:|---|
| accounts | 9 | 资料、账号状态、资产、恢复、注销 |
| admin | 8 | 权限与操作审计 |
| admin-auth | 3 | 独立会话、Cookie、失效 |
| affiliate | 1 | 返佣与退款反冲，无真实提现 |
| ai | 19 | 供应商/模型生命周期、成本与预算 |
| analytics | 9 | 口径、去重、漏斗 |
| billing | 9 | 预占/结算/释放/恢复 |
| characters | 14 | 创作、公开、评论、资源、任务 |
| checkins | 2 | 重复领取与日界线 |
| circles | 6 | 成员、权限、订阅 |
| coins | 5 | 余额、账本、套餐 |
| community | 6 | 审核、申诉、可见性 |
| compliance | 1 | 注册策略消费点 |
| conversations | 7 | 消息、回合、分享授权、导出 |
| creators | 2 | 公开资料、关注关系 |
| discovery | 1 | 目录与筛选 |
| disputes | 9 | 投票、结案、撤回 |
| gifts | 3 | 价格、库存语义、账本 |
| growth | 5 | 引导、模块开关、邀请 |
| memberships | 1 | 参数、快照、权益与退款 |
| memory | 5 | 来源、确认、预算、注入 |
| mirror | 12 | 生成、结果、购买与分享 |
| missions | 2 | 条件、完成与领取 |
| notifications | 4 | 归属、已读、去重 |
| operations | 11 | 维护、证书、运行状态 |
| payments | 22 | 商户、开关、回调、退款 |
| posts | 3 | 可见性、评论、计数 |
| referrals | 1 | 直接关系与重复绑定 |
| settings | 5 | 配置版本、覆盖与公开白名单 |
| site-content | 5 | 草稿、发布、恢复与前台投影 |
| stories | 12 | 章节状态、工作任务、重试和历史失效 |
| tasks | 3 | 可执行定义、状态、重跑 |
| uploads | 6 | 归属、格式、删除和引用 |

## 10. 全量API目录

共 210 个路由文件。方法来自导出的HTTP函数；此表用于后续逐项勾验，不能凭路由存在判定真实功能可用。动态段须用隔离或授权测试资源，不遍历真实用户数据。

| 路由 | HTTP方法 | 本轮验证等级 |
|---|---|---|
| `/api/admin/accounts` | GET, POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/accounts/[id]` | GET, PATCH | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/accounts/[id]/profile` | GET, PATCH | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/accounts/[id]/settings` | GET, PUT | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/accounts/[id]/settings/[key]` | DELETE | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/ai/coin-prices` | GET, POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/ai/costs` | GET, POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/ai/models` | GET, POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/ai/models/[id]` | GET, PATCH, DELETE | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/ai/models/[id]/test` | POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/ai/prices` | GET, POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/ai/providers` | GET, POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/ai/providers/[id]` | GET, PATCH, DELETE | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/ai/providers/[id]/test` | POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/analytics` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/analytics/ops-metrics` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/analytics/product-funnel` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/analytics/scene-funnel` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/audit` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/auth/login` | POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/auth/logout` | POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/auth/session` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/billing/charges` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/characters` | GET, POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/characters/[id]` | GET, PUT, DELETE | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/characters/[id]/models` | GET, PUT | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/characters/[id]/publication` | POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/characters/publication` | POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/circles` | GET, POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/circles/[id]` | GET, PATCH | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/circles/[id]/members` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/circles/[id]/members/[userId]` | PATCH | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/community/comments` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/community/comments/[id]` | PATCH | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/community/posts` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/community/posts/[id]` | PATCH | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/compliance` | GET, PATCH | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/disputes/cases` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/disputes/cases/[id]/close` | POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/disputes/cases/[id]/hide` | POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/finance/callback-alerts` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/finance/orders` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/finance/orders/[orderNo]/refund` | POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/finance/orders/all` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/finance/orders/export` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/finance/packages` | GET, POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/finance/packages/[id]` | PUT, DELETE | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/finance/reconciliation` | GET, POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/finance/reconciliation/[id]` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/finance/report` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/growth/affiliate` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/growth/checkins` | GET, PUT | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/growth/gifts` | GET, POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/growth/gifts/[id]` | PATCH, DELETE | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/growth/missions` | GET, POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/growth/missions/[id]` | PATCH, DELETE | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/growth/modules` | GET, PUT | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/growth/referrals` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/growth/rewards` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/memberships` | GET, PATCH, DELETE | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/mirror/results` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/mirror/results/[id]` | DELETE, PATCH | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/moderation/appeals` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/moderation/appeals/[id]` | PATCH | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/moderation/audit` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/moderation/characters` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/moderation/characters/[id]` | PUT | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/moderation/characters/batch` | POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/moderation/reports` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/moderation/reports/[id]` | PATCH | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/notifications/stats` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/operations` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/operations/backups` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/operations/certificate` | GET, POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/operations/maintenance` | GET, PATCH | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/operators` | GET, POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/operators/lookup` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/payments/checkout` | GET, PUT | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/payments/merchants` | GET, POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/payments/merchants/[id]/test` | POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/roles` | POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/roles/[id]` | DELETE | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/settings` | GET, PATCH | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/settings/export` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/settings/history` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/settings/import` | POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/settings/import/confirm` | POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/settings/prompts/preview` | POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/settings/restore` | POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/site-content` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/site-content/[type]` | POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/site-content/[type]/[id]` | PATCH | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/site-content/[type]/[id]/revisions` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/site-content/[type]/[id]/revisions/[revisionId]/restore` | POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/tasks` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/admin/tasks/[id]/run` | POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/ai/models` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/ai/usage` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/analytics/funnel-events` | POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/auth/account/activate` | POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/auth/email/resend` | POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/auth/email/verify` | POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/auth/login` | POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/auth/logout` | POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/auth/me` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/auth/password/forgot` | POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/auth/password/reset` | POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/auth/register` | POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/characters` | GET, POST | 公开GET返回已核对 |
| `/api/characters/[id]` | GET, PUT, DELETE | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/characters/[id]/bookmark` | POST, DELETE | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/characters/[id]/comments` | GET, POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/characters/[id]/gift` | POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/characters/[id]/like` | POST, DELETE | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/characters/[id]/quests` | GET, POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/characters/[id]/quests/[questId]/complete` | POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/characters/reply-plan` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/checkin` | GET, POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/checkin/status` | 需查看导出别名 | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/circles` | GET, POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/circles/[id]` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/circles/[id]/posts` | GET, POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/circles/[id]/subscription` | PUT, DELETE | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/coins/ledger` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/coins/orders` | POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/coins/orders/[orderNo]` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/coins/packages` | GET | 公开GET返回已核对 |
| `/api/coins/payments/ezfp/notify` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/coins/purchase` | POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/comments/[commentId]` | PATCH, DELETE | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/comments/[commentId]/like` | POST, DELETE | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/community-appeals` | GET, POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/compliance/registration-policy` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/conversations` | GET, POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/conversations/[id]` | GET, PATCH, DELETE | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/conversations/[id]/export` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/conversations/[id]/memory` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/conversations/[id]/memory/[factId]` | PATCH, DELETE | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/conversations/[id]/memory/[factId]/confirm` | POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/conversations/[id]/memory/[factId]/ignore` | POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/conversations/[id]/messages` | GET, POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/conversations/[id]/messages/[messageId]` | PATCH, DELETE | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/conversations/[id]/messages/[messageId]/like` | POST, DELETE | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/conversations/[id]/messages/[messageId]/regenerate` | POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/conversations/[id]/messages/attachments` | POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/conversations/[id]/share` | POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/conversations/[id]/turns` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/creators` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/creators/[username]` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/creators/[username]/activity` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/creators/[username]/connections` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/creators/[username]/follow` | POST, DELETE | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/disputes` | GET, POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/disputes/[id]` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/disputes/[id]/vote` | POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/disputes/[id]/withdraw` | POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/disputes/excerpt` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/disputes/options` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/events` | POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/explore` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/gifts` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/growth/invite` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/growth/invite/visit` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/growth/onboarding` | GET, POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/home` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/horoscope/[sign]` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/leaderboard/gifts` | GET, POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/me/membership` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/me/membership/refund` | POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/me/membership/refund-preview` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/me/notifications` | GET, POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/me/notifications/[id]` | PATCH | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/me/quota` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/memberships` | GET | 公开GET返回已核对 |
| `/api/memberships/checkout` | POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/memberships/payments/ezfp/notify` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/mirror` | GET, POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/mirror/[shareId]` | GET, DELETE | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/mirror/compare` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/missions` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/missions/[id]/complete` | POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/operations/status` | GET | 公开GET返回已核对 |
| `/api/post-comments/[id]` | PATCH, DELETE | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/posts/[id]` | PATCH, DELETE | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/posts/[id]/comments` | GET, POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/public-character/[id]` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/public-conversations/[id]` | GET | 源码确认分享权限缺口；未读取真实私聊 |
| `/api/rankings` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/referrals/me` | GET, PATCH | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/reports` | GET, POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/seo/sitemap` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/site` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/site/announcements` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/site/pages/[slug]` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/stories` | GET | 公开GET返回已核对 |
| `/api/stories/[slug]` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/story-runs` | GET, POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/story-runs/[id]` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/story-runs/[id]/close-chapter` | POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/story-runs/[id]/export` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/story-runs/[id]/resume` | POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/story-runs/[id]/turns` | POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/story-runs/[id]/turns/[turnId]/retry-state` | POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/ui-config` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/universes` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/upload` | POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/uploads/[name]` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/users/me` | GET, PUT | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/users/me/close` | POST | 目录盘点；具体链路见能力表，未逐路由实测 |
| `/api/users/me/export` | GET | 目录盘点；具体链路见能力表，未逐路由实测 |

## 11. 细粒度前后端联动规格（深化版）

本节在原70项能力矩阵之下继续拆分为可开发的交互条目，作为后续实施规格；原矩阵保留事实基线。标记“拟新增”的接口、字段、配置是设计提案，不是已经上线。各子表ID仅用于追踪，不表示另建一批文件或按ID创建模块。

本轮复用线上源码缓存和既有测试结果；再次确认线上HEAD未变，定向读取GitHub相关文件，不重复全量扫描、不执行数据库写入或真实模型调用。由三个子智能体分别整理聊天/记忆、发现/创作/社区、账号/商业配置，主线程统一配置边界、模块归属与扩展项。

### 11.1 配置应放在哪里

| 参数种类 | 唯一事实来源 | 谁可修改 | 前台读取方式 | 禁止做法 |
|---|---|---|---|---|
| 商业价格、权益和退款政策 | MembershipPlan/Policy及订单快照；金币价格/计费领域 | 财务或被授权管理员 | 会员目录、quota、reply-plan、订单与退款预估等专用投影 | 在组件写价格、按客户端时间授权权益、改配置追溯改老订单 |
| 业务限额、功能开放与提示词 | 现有settings registry、OperationSetting及覆盖规则 | 对应设置权限 | 公开白名单或登录态能力投影；最终由服务端校验 | 将完整配置库/私有提示词发给浏览器 |
| 用户偏好 | 账号字段或拟扩展的用户偏好对象 | 用户本人 | /api/users/me 等本人接口 | 把用户字体喜好做成全站管理员设置 |
| 内容和运营推荐 | characters、site-content、stories、growth等所属领域 | 对应内容/运营角色 | 各领域公开查询 | 前端硬编码推荐角色、未发布内容进入推荐 |
| 运行能力 | 服务端模型可用性、开关、预算、账户权限综合计算 | 供应商/模型/预算权限 | 拟扩展能力投影：可用、原因、限制及版本 | 前端见按钮就认为可调用；停用后仅隐藏按钮 |
| 纯交互常量 | packages/ui设计变量或所属前端组件 | 代码维护 | 构建资源；用户可选偏好另存账号 | 为每个间距、滚动阈值、焦点行为建立后台配置 |
| 密钥与外部连接 | 现有服务端基础设施与密钥存储 | 特定管理员 | 仅状态/掩码，浏览器不取密钥 | 为便于前端联动公开供应商秘密 |

现有 registry中的默认值是受控回退，不等于允许页面独立硬编码业务规则。新增业务设置必须同时补注册定义、服务端校验、实际消费点、允许暴露的投影和后台编辑说明；不要求每个交互增加配置键。

### 11.2 接口与字段的读法

“现有”需在当前路由/契约查到；“拟扩展”优先扩现有接口而非重新造平行服务；“拟新增”先在contracts定义请求/响应、错误和版本，再在apps/api添加薄适配层。下面写出的新字段名是候选规格，迁移前核对现有模型，避免同义字段重复。

服务端返回的available/reason之类能力投影为拟设计，不表示当前所有接口已有。复杂操作至少区分无权限、未开放、资源失效、冲突、余额不足、处理中、可重试失败，前台应根据明确状态显示，不根据一段报错文本猜测。


### 11.3 聊天、消息、记忆与会话：44项

已有表示代码链路存在，不等同于本轮重新实测。配置通过现有admin/settings、ui-config白名单或业务专用投影流转；拟新增项目不能只建UI。C组由聊天子智能体针对性核对GitHub契约和服务，下面保留逐项实施规格。

| ID/状态/优先级 | 前端细节 | 后台配置/来源 | API：现有或拟新增 | 数据关系与模块 | 完成条件 |
|---|---|---|---|---|---|
| C01 部分 P1 | 自动增高多行输入、内部滚动 | chat.maxMessageChars；高度属设计规范 | GET ui-config；POST /api/conversations/{id}/messages | Message.content；web/chat、conversations、contracts | 前后端字数一致；键盘不遮发送 |
| C02 已有基础 P1 | 中文组词不误发送；换行发送规则明确 | 无运营参数；快捷键属拟用户偏好 | 复用发送；拟扩users/me偏好 | useCompositionGuard；web/chat；持久偏好归accounts | 候选词确认不误发 |
| C03 部分 P1 | 会话草稿刷新返回保留，成功清除 | 设备内账号隔离；云同步后做 | 设备内无API；云同步拟GET/PUT/DELETE /api/conversations/{id}/draft | 当前input内存；键含userId/conversationId；云同步才新模型 | 切会话账号不串；失败不清空 |
| C04 已有 P1 | 发送/输出/失败状态，防重复 | limits.chat.perWindow/windowSeconds | POST messages；GET /api/conversations/{id}/turns?requestId=… | 请求ID→费用单→回复；use-chat-turns/turn-request；conversations/billing | 双击慢网429不重复消息费用 |
| C05 已有 P1 | 取消前显示政策、免费取消剩余 | billing.cancelPolicy/freeCancelPerDay | /api/me/quota；SSE；turns | HELD/SETTLED/RELEASED/UNKNOWN费用状态；stream-cancel与billing | 取消不是只停动画，结果可追踪 |
| C06 部分 P1 | 断线区分未发送/待确认，查原请求再重试 | 复用回执幂等，不造重试运营开关 | GET turns及原POST | pending ref拟与草稿持久化，账号会话隔离 | 刷新找回回复、不第二次扣费 |
| C07 已有 P1 | 额度余额、模型费用、重置时间；不足留草稿 | billing.freeDailyMessages/hardDailyMessages/priceMultiplier/dayTimezone；模型币价与会员 | quota；/api/ai/models?conversationId=…；cost事件 | 规则权益账本投影；use-quota；billing/memberships/ai | 显示等于实付，不靠客户端减余额 |
| C08 已有 P2 | 快捷语增删改，不覆盖原草稿 | User.shortcuts，限制共用契约 | GET/PUT /api/users/me | shortcuts JSON；profile/preferences→chat；accounts保存 | 刷新保留，超限可见 |
| C09 部分 P2 | 表情贴纸面板、反馈、重试 | 当前CHAT_STICKERS代码目录；后台运营目录拟新增 | messages/attachments；拟GET /api/stickers及admin目录 | Attachment.STICKER/stickerId；contracts目录；attachments | 下架后端拒绝，重放不重复 |
| C10 部分 P1 | 图片缩略预览、大小、移除；上传保存分状态 | upload.maxMB；limits.upload.perWindow/windowSeconds | POST /api/upload；messages/attachments | UploadAsset.ownerId→Attachment.uploadAssetId→Message；uploads/attachments | 他人资源伪装文件拒绝，失败可重试 |
| C11 拟新增 P1 | 帮我接一句、换一批、编辑插入，不代发 | 拟接话任务开关/额度/模型/预算，不偷用聊天额度 | 拟POST /api/conversations/{id}/suggestions | 历史记忆+AI调用记录，不写普通Message；conversations/workflows、chat | 基于当前会话，建议与发言消费分开 |
| C12 拟新增 P2 | 区分保存图片与AI识图 | 拟视觉能力模型价格，复用上传限制 | 现有附件；拟扩消息版本契约 | 资产→ai适配器→调用账单；ai/conversations/uploads | 上游收到合法图像，未消费不收费 |
| C13 部分 P1 | 长按/更多菜单，按角色状态显示动作 | 无额外参数，权限在服务端 | 复用各操作API | message-actions；通用菜单ui，业务chat | 触屏键盘可达，生成中不误删 |
| C14 部分 P1 | 复制反馈、失败手动选择 | 无后台参数 | 无API | 客户端message-actions | 失败不静默，复制可见正文 |
| C15 已有 P2 | 点赞取消防连击，失败回滚 | 个人反馈非公共热度 | POST/DELETE /messages/{mid}/like | Message.likedAt；use-chat-thread；message-service | 刷新一致，越权拒绝 |
| C16 已有基础 P1 | 编辑前说明删除后续历史 | 编辑4000常量与发送chat.maxMessageChars不同，需统一或正式分规则 | PATCH messages/{mid}；POST regenerate | Message后续行、MemoryFact失效、摘要删除、故事失效；事务 | 上限一致、影响明确、历史同步 |
| C17 部分 P1 | 重生成说明范围费用，失败留原文 | 现有价格取消政策，不写免费承诺 | POST /messages/{mid}/regenerate；GET turns | 替换prompt之后内容；billing及memory/story失效 | 空回复不毁旧文，成功无过期历史 |
| C18 拟新增 P2 | 同轮候选切换、当前/总数 | 复用生成价格，开放额度需正式登记 | 拟GET /messages/{mid}/versions、PATCH selected-version | 拟候选/选中关系，非StoryTemplateVersion；conversations/contracts | 可见版本等于上下文，后续分支明确 |
| C19 后端有入口缺 P1 | 删除显示此条及之后并确认 | 拥有者权限，不造假删除开关 | 现有DELETE /messages/{mid} | 按createdAt,id删除并失效记忆故事；message-service | 同毫秒不误删前项 |
| C20 拟新增 P2 | 消息处分支，保留原会话和来源 | 限额收费未定不编造 | 拟POST /api/conversations/{id}/branches | 拟父会话/来源消息关系；记忆复制范围；conversations | 原会话不变、不复制费用、记忆不串 |
| C21 部分 P2 | 浏览器朗读停止、能力提示 | 本地speechSynthesis无云价格 | 当前无云API，云TTS另设 | web/lib/speech；云归ai/uploads/billing | 切页停止，不宣传角色电话 |
| C22 已有 P1 | 举报原因、状态、记录与进度 | 举报类型、limits.report.perWindow/windowSeconds | POST /api/reports及admin审核 | Report→Message→Conversation；沿用现有举报入口，实施定点核对具体服务；web/moderation | 失败不假成功、后台可处理 |
| C23 已有基础 P1 | 上滑分页保位置、失败重试 | 技术分页不等于chat.historyMessages模型历史 | GET messages?limit=…&before=… | createdAt,id游标；message-history-client/use-chat-thread/message-service | 不重不漏、不跳位 |
| C24 已有基础 P1 | 回看不被流式打断，回到最新 | 纯交互无后台参数 | 无新增API | useChatScroll；web/chat | 贴底跟随，上翻停止，点击恢复 |
| C25 部分 P2 | 只读历史分页和附件统一渲染 | 无额外参数 | 复用messages分页，export只下载 | 当前chat-history-page用export且仅文本；web/chat | 长历史流畅、附件可见 |
| C26 部分 P1 | TXT/JSON范围说明、附件引用、重试 | 导出格式契约不运营拼字段 | GET export?format=json或txt | readConversationExport未取MessageAttachment；conversations/contracts | 附件不丢、仅本人可导出 |
| C27 拟新增 P2，先修P0 | 选条分享预览脱敏撤销 | 拟分享范围有效期，非客户端硬编码 | 现有share缺授权；拟授权创建/列表/撤销/公开读 | 独立授权快照非裸会话ID；conversations | 未分享不可读，后续不公开 |
| C28 已有基础 P2 | 阅读模式、屏蔽折叠、对白动作排版 | User.readingMode/bannedWords，非审核禁词 | GET/PUT users/me | auth context→RoleplayText；profile/chat/accounts | 刷新生效、不删原文、不当AI禁词 |
| C29 已有 P1 | 继续上次和新建分开 | 用户操作，无全站参数 | POST conversations characterId/newChat | userId+characterId，普通复用排除storyRun；conversation-service | 新建独立ID，继续原记录 |
| C30 部分 P2 | 重命名保存取消非空 | 标题长度统一契约 | PATCH conversation title | Conversation.title；列表菜单与服务 | 刷新导出标题一致 |
| C31 拟新增 P2 | 置顶取消，与最近排序区分 | 数量限制有需求才登记 | 拟扩PATCH pinned | 拟pinnedAt及后端排序；conversations | 跨设备一致，归档行为明确 |
| C32 已有 P1 | 归档恢复可发现、不是删除 | 无后台参数 | PATCH archived；GET conversations?archived=true | archivedAt；关系面板列表与服务 | 恢复可见，历史资产不丢 |
| C33 部分 P1 | 列表分页，名称搜索范围提示 | 当前take:200非分页；技术边界契约 | GET conversations拟扩limit/cursor/q | updatedAt稳定游标索引；provider/conversations | 第201个可达，失败非空态 |
| C34 拟新增 P2 | 全文片段并定位消息 | 鉴权查询长度限流，不配关键词名单 | 拟GET /api/conversations/search?q=…&cursor=… | Message.content→所属Conversation；conversations | 真搜正文，定位命中附近 |
| C35 部分 P1 | 私人备注保存反馈、仅自己看 | notes当前不注入AI | PATCH conversation.notes | Conversation.notes；面板/服务 | 刷新保留，失败不假保存 |
| C36 部分 P1 | 关系模式说明效果范围 | relationshipMode已有；拟后台效果规则后端消费 | PATCH conversation；发送需消费 | 关系模式→实际AI请求；conversations/ai | 开关真正改变上下文 |
| C37 部分 P1 | 等级来源、下一阶段、变动记录 | TIERS占位；拟成长政策，数值不编造 | 现有字段；拟规则/记录查询 | romance/intimacy+拟幂等事件；conversations | 不重复成长，不允许客户端随意加值 |
| C38 部分 P1 | 记忆关闭/空/加载/失败四态 | memory.enabled，失败非关闭 | GET /conversations/{id}/memory | 双重归属；memory-panel/fact-service | 500可重试，不闪现旧会话 |
| C39 部分 P1 | 确认转已生效，忽略才移除 | memory开关，无额外价格 | POST memory/{factId}/confirm或ignore | PENDING→ACTIVE/DELETED；修复当前filter | 刷新一致，下一轮只注入ACTIVE |
| C40 已有基础 P1 | 编辑固定删除及逐项错误状态 | memory.maxFacts是注入数；200字200条常量若可调需登记 | PATCH/DELETE memory/{factId} | text/pinned/status；fact-service/context | 字数定义一致，删除不注入 |
| C41 部分 P2 | 添加、记住这句、来源定位 | create函数有但集合路由尚无POST | 拟POST /conversations/{id}/memory | sourceMessageId需同会话验证；memory/conversations编排 | 他人来源拒绝，来源修改后失效 |
| C42 已有 P1 | 作用范围预算摘要状态，不承诺无限 | memory.summaryTriggerMessages/summaryMaxChars/maxFacts/contextBudgetTokens；prompt.memorySummary；ai.taskModel.memorySummary；budget.task.memorySummary | 面板GET；摘要拟安全读投影 | ConversationMemory.coveredMessageId/version及事实→任务→context | 关闭不注入生成，预算失效有效 |
| C43 拟新增 P2 | 多身份、会话绑定和切换影响 | 身份数量长度按需求登记，roleTemplate非用户身份 | 拟身份CRUD与personaId绑定 | 拟UserPersona.userId→Conversation；accounts或成熟独立域/workflows | 不绑定别人身份，实际进上游不改旧史 |
| C44 拟新增 P2 | 世界书条目触发词命中说明 | 拟开关预算优先级，非现有universes | 拟用户/角色世界书CRUD | 拟书条目绑定和命中；成熟后worldbooks | 触发权限预算生效，引用可解释 |

数据边界：MemoryFact的conversationId/sourceMessageId目前不是Prisma关系，不能假定级联清理。“记住这句”开放前定点检查来源归属及删除清理。后台记忆参数当前group为growth，可先调整显示分区，不迁移全部key或复制参数。

证据：[设置登记表](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/packages/contracts/src/settings/registry.ts)、[会话服务](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/packages/backend/src/modules/conversations/conversation-service.ts)、[消息服务](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/packages/backend/src/modules/conversations/message-service.ts)、[记忆服务](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/packages/backend/src/modules/memory/fact-service.ts)、[交互组件](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/apps/web/src/components/chat/chat-interaction.tsx)、[模型](https://github.com/pvpli7032-wq/Rumiai/blob/883a946fd5680d540b074bb9ddfe612df81288fb/database/schema.prisma)。

### 11.4 发现、角色、创作、故事、社区与通知：42项

D01/D02/D08/D09/D10/D17/D21/D22/D26按P1处理；其余P2，其中云草稿D23、故事分支D33可后期。已有基础项不代表本轮逐按钮实测。目录分页为技术契约，不为此堆运营参数。

| ID/状态 | 前端细节 | 后台配置 | API：现有或拟新增 | 数据关系与模块 | 验收 |
|---|---|---|---|---|---|
| D01 部分 | 全站搜索输入清空提交、结果状态；当前只过滤已载热门/最新 | 已有标签；查询长度分页上限归服务契约 | GET /api/characters，API参数search、重复tag、sort（服务内转tags）；前台需接通，游标拟扩 | Character.name/tagline/tags且公开审核通过；discover→characters/catalog-service/contracts | 非首批角色也能找到，清空恢复列表 |
| D02 已有基础 | 多选筛选、条件移除清空、说明交集语义 | CMS Tag.key/label/filterRow/group | characters重复tag参数；现有站点标签投影 | tags匹配key，显示label；discover/site-content/characters | 分享URL刷新返回保留；后端语义一致 |
| D03 拟新增 | 搜索历史单删清空、空输入显示 | 无需运营参数；热搜如做另属运营资源 | 设备内无API；云同步拟GET/PUT /api/me/discovery-preferences | 账号键或拟用户偏好，不进公共CMS；discover/accounts | 切账号不泄露历史，清空不恢复 |
| D04 拟新增 | 无结果与服务异常分开，清部分条件、相关标签 | 相关标签CMS；运营文案归site-content | 复用搜索/站点API及明确错误状态 | 查询、有效标签、公开角色；discover/characters/site-content | 500可重试，不伪造推荐 |
| D05 部分 | 推荐策略数量服务端统一；当前前端独家优先热门补齐、多个12固定 | 拟discovery.recommendationStrategy/railLimit，支持有限枚举；优先复用CMS分区 | 拟推荐投影，复用现有目录/内容 | HomeSection、isExclusive/chatCount/createdAt；discovery管策略，CMS管分区 | 后台改后不用发版，不同区不假重复 |
| D06 拟新增 | 不感兴趣/屏蔽、撤销和列表 | 拟功能开放；本人名单不是后台逐个手填 | 拟PUT/DELETE /api/me/hidden-characters/[id] | 拟UserHiddenCharacter唯一关系；accounts/discovery；卡片 | 刷新换设备不推荐，撤销恢复不影响他人 |
| D07 部分 | 故事/关注等分区独立加载错误重试，当前部分失败静默隐藏 | mirror.enabled/dispute.enabled；story.enabled已有，需消费 | /api/stories、/api/characters?scope=following | 各区错误与空态分开；use-discover-data | 一区失败不拖全页也不假空 |
| D08 已有基础 | 详情关闭保筛选滚动分页 | 纯路由交互不运营配置 | 无新API，目录分页复用 | URL q/type/role/view/batch/character、历史栈；discover/navigation-history | 手机返回先关详情，保原位置 |
| D09 部分 | 兴趣选择立即更新推荐，当前只结束时保存 | growth.onboardingEnabled/interestTags | GET/POST /api/growth/onboarding；拟不完成式推荐预览 | interestsJson/onboardedAt；标签评分；growth | 改兴趣真换结果，预览不标完成，跳过不反复弹 |
| D10 拟完善 | 可编辑开场选择、普通/场景区别 | 角色greeting/scenario；新首聊模板归角色场景内容 | 角色详情/会话创建；动态建议归聊天 | 角色场景草稿与漏斗事件；growth/characters/conversations | 新人可直接选一句，不未经确认发言扣费 |
| D11 已有基础 | 图库左右圆点已有，补序号全屏滑动失败占位 | CharacterImage.sortOrder及资产管理 | GET /api/characters/[id] | 图片头像、可读角色；characters/managed-assets/uploads，web/detail | 顺序一致，坏图不挡返回聊天 |
| D12 拟完善 | 简介人设背景开场各自展开收起，保换行位置 | content.character.nameMax/summaryMax/personaMax/backgroundMax/openingMax；展开是展示常量 | 现有详情 | personality/background/greeting/scenario/copyrightStatement；catalog与detail-tabs | 长内容不溢出，私有角色不越权 |
| D13 部分 | 详情标签显示label并可点筛选，当前直接key | Tag.key/label/group/filterRow | 站点标签、角色搜索复用 | Character.tags→Tag.label；contracts投影/site-content/detail | 后台改名两处同步，缺失值回退一致 |
| D14 已有基础 | 作者入口关注状态、失败恢复，匿名登录后回详情 | 作者公开资料，不配伪粉丝数 | creators/[username]及follow | Character.creatorId、Follow；creators/detail | 关注刷新保留，错误回滚 |
| D15 已有 | 点赞收藏锁、反馈、收藏页一致 | 服务器状态，不前端造计数 | POST/DELETE characters/[id]/like及bookmark | CharacterLike/Bookmark唯一关系；engagement-service/detail | 连点只一条，取消刷新同步 |
| D16 已有基础 | 继续/新建已存在，补最近会话提示及含义 | 角色模型有效性服务端裁决 | POST conversations创建复用 | 角色用户会话场景，原会话保留；conversations/detail | 继续原ID、新建新ID，不可用有原因 |
| D17 已有基础 | reply-plan展示免费/会员差价/模型/错误 | 后台模型scope、金币价格、会员权益 | characters/reply-plan；ai/models | CharacterAiModel、额度权益价格；characters/billing/memberships | 详情报价与实扣一致，切模型更新 |
| D18 已有基础 | 评论排序分页编辑删除点赞举报，失败留草稿 | content.comment.maxChars；审核速率复用已查规则，不编key | characters/[id]/comments；comments/[commentId]及like；排序拟扩 | 角色作者评论状态/赞/举报；characters/comment-service与审核入口 | 权限计数可见性一致，隐藏评论不公开 |
| D19 已有基础 | 任务进度条件、领取时间、失败恢复 | CharacterQuest.requiredMessages/rewardCoins | GET characters/[id]/quests；POST quests/[questId]/complete | CharacterQuest/UserCharacterQuest、消息、账本；characters/coins | 未达标不领，重复一笔，金额可追 |
| D20 已有基础 | 礼物确认价格，配角维持介绍语义 | GiftCatalog启用价格；角色配角/情绪资产 | gifts；POST characters/[id]/gift；详情 | GiftCatalogItem/Gift/账本；SupportCharacter/CharacterEmoji；gifts/characters/coins | 篡改客户端价格无效；名单不是群聊 |
| D21 部分 | 字段校验一致；当前人设最少40前端硬编码 | max keys已有；如保留最少拟content.character.personaMin | POST/PUT characters[/id]；ui-config | Character；contracts/characters、settings、validation、creator | 改参数显示后端都生效，绕过前端仍受约束 |
| D22 部分 | 本地自动存草稿、快捷保存清空已有；账号隔离需补 | 无后台参数 | 无新API，读现有认证身份 | draftKey须userId+editId；现有creator-draft/use-creator-form | A切B不见草稿，A重登可恢复；旧稿不可错归属 |
| D23 拟新增 | 云草稿、保存中失败冲突，不能把本地叫云存 | 草稿生命周期和服务上限，不造通用存储平台 | 拟扩角色草稿契约，与发布分开 | 非公开Character草稿或专属版本、userId/version/updatedAt；characters/creator | 跨设备恢复，并发不静默覆盖 |
| D24 已有基础 | 头像上传进度取消重试预览，新图失败留旧图 | upload.maxMB及上传频率、类型契约 | POST upload；角色保存受管引用 | UploadAsset.ownerId→avatarUrl；uploads/characters/creator | 伪装他人资源拒绝，未采用资产按既有清理规则 |
| D25 已有基础 | 标签徽章搜索分组、移除、下架旧值解释 | 现有CMS目录；数量上限先查现有再统一契约 | site内容与角色保存 | Tag/Badge→tags/badges；site-content/characters/creator | 目录改动可见，未知旧值不默删 |
| D26 已有基础 | 发布前检查，草稿待审拒绝公开清晰 | 角色发布审核规则、版权、拒绝原因 | 角色保存；admin/moderation/characters/[id]及publication | publicationRequested/reviewStatus/reviewReason/isPublic；characters审核/创作 | 申请不直接公开，拒绝后可修再投 |
| D27 拟完善 | 预览用实际展示组件；真实试聊说明成本保存范围 | 现有模型计费，不用固定示例冒充AI成功 | 视觉预览无API；真实试聊复用鉴权conversation | 草稿与已保存角色区分，测试会话私有；creator/characters/conversations | 设定预览同步，真实失败不假成功 |
| D28 已有基础 | 我的角色编辑删除状态、影响说明 | 后端删除条件，不用前端可删布尔绕引用 | GET characters?scope=mine；PUT/DELETE characters/[id] | 作者角色会话帖子审核举报；creator-service/privacy | 仅本人合法操作，历史按规则保留无悬空 |
| D29 已有基础 | 故事简介角色章节、可继续、空/错分开 | story.enabled/enabledTemplates，发布版本 | GET stories、stories/[slug]；POST story-runs | StoryTemplate/PublishedVersion与角色可见性；catalog/repository/web/stories | 禁用不能绕路新开，旧run继续策略明确 |
| D30 部分 | 静态建议与动态区分；按本回合显示可编辑建议 | story.actionSuggestions key存在但消费待补证；动态模型预算复用 | 现有turns；拟扩流事件 | run/turn/revision建议；stories/turn-service/contracts/story-mode | 后台条数真改变结果，不用过期建议自动发言 |
| D31 已有 | 整理中/可结束/失败/继续用可理解状态 | story.stateBatchSize/stateMaxAttempts | close-chapter、resume、turns/[turnId]/retry-state | StoryRun.status/revision、Turn.stateStatus、任务；lifecycle/worker | 未整理完不得非法结束，重试刷新一致 |
| D32 后端有前台拟完善 | 正文事实约定章节摘要时间线 | 类型用contracts枚举，不复制状态规则 | GET story-runs/[id] | StoryEvent、turnNo/chapterKey及来源；state-model/web/stories | 来源失效后不当有效事实，推测非用户确认 |
| D33 拟新增 | 存档分支入口，检查点不等于可读档 | 拟支持数量开关；售卖额度须真实消费 | 拟存档/分支API先定stories契约 | Checkpoint及拟父分支/revision/记忆范围；lifecycle/workflows | 读档不重扣历史费用、不污染原分支 |
| D34 后端有待闭环 | 故事导出范围错误重试，区别公开分享 | 领域权限，无任意导出字段配置 | GET story-runs/[id]/export | 本人run/有效回合事件，不含私有模板提示；export-service/web | 非本人拒绝，导出等于有效历史 |
| D35 已有基础 | 圈子访客未订阅已订阅受限状态及原因 | 圈子/成员限制，后端执行 | circles/[id]；subscription POST/DELETE依现有契约 | Circle/Member/限制与发言权限；circles/community/feed | 取消或受限不能绕API发布 |
| D36 已有 | 发帖逐图预览移除重试、失败保留 | content.post.maxChars/maxImages；upload.maxMB | upload；POST circles/[id]/posts | Post/PostMedia/UploadAsset；关联角色可见性；posts/uploads/characters | 参数前后端同步，绕过浏览器拒绝 |
| D37 已有 | 帖评编辑删除、冲突保草稿，影响说明 | 统一内容长度及审核规则 | PATCH/DELETE posts/[id]、post-comments/[id]含updatedAt | Post/Comment.updatedAt、状态审核举报；posts/community | 旧版本冲突不丢稿，计数可见性刷新一致 |
| D38 部分 | 长feed评论按展开加载分页保位置，当前逐帖并发读 | 页上限服务契约，不堆运营参数 | 复用帖子评论GET，cursor缺则扩展 | createdAt/id游标，计数与预览分开；posts/contracts/community | 初屏不抓全部评论，展开只取目标 |
| D39 已有基础 | 举报申诉目标原因状态与结果，受限可申诉 | 后台审核权限原因，前台不判罚 | reports/community-appeals及admin审核 | 举报人目标、ModerationAction/Appeal、结果通知；community/notifications/moderation | 重复规则明确，私有举报不泄露 |
| D40 已有 | 分页、单条/全部已读、错误回滚已有，补提示重试 | 通知类型共享契约，无新运营参数 | GET/POST /api/me/notifications；PATCH /[id] | userId/readAt、cursor/unreadCount；notifications/use-notifications | 连点不重复减，交错分页不重 |
| D41 拟完善 | 通知定位具体目标，已删/无权有解释落点 | 类型决定安全目标，不由任意模板拼链接 | 现有通知拟扩target投影/目标错误状态 | 通知目标当前可见性与权限；notifications及目标领域 | 私有角色删帖不泄露，不跳空页 |
| D42 拟新增 | 分类偏好免打扰，站内通知不等于推送主动聊天 | 拟允许类别/个人偏好，运营需权限 | 拟GET/PUT /api/me/notification-preferences | 偏好时区与事件；accounts/notifications/profile | 关闭后后端也停止可选投递，不仅前端隐藏 |

定点证据文件：apps/web/src/components/discover/use-discover-data.ts、characters/character-detail-dialog.tsx、creator/use-creator-form.ts、notifications/use-notifications.ts、community/circle-feed.tsx，以及packages/backend/src/modules/characters/catalog-service.ts、packages/contracts/src/settings/registry.ts。均固定本报告基线。新发现：前端搜索只在两份最多50项列表筛选、多个推荐区固定12、详情直接tag key、人设最少40硬编码、草稿键无账号、feed逐帖读评论。实施针对这些路径，不另造整站搜索/草稿框架。

### 11.5 账号、会员、资产与后台：34项

已有表示源码存在，本轮不修改真实用户、会员、订单或支付开关。规则分三类：OperationSetting公共规则、UserSettingOverride用户特例、MembershipPlan/Policy会员专属配置。不要把它们混进一个JSON。A01–A05/A08–A11/A13–A24/A26–A30/A32–A33按P1落实已有承诺；A06–A07/A12/A25/A31/A34按P2完善。真实收款持续关闭。

| ID/状态 | 前端细节 | 后台配置/来源 | API：现有或拟新增 | 数据关系与模块 | 最小验收 |
|---|---|---|---|---|---|
| A01 已有 | 昵称用户名头像分字段，防重复，失败留输入，成功刷新用户 | 现有资料管理，无逐字段运营开关 | GET/PUT users/me；GET/PATCH admin/accounts/{id}/profile | username/displayName/avatarUrl/accountVersion；web/profile、admin/accounts；accounts双profile服务 | 前后台回读一致，用户名冲突可解释 |
| A02 部分 | 头像预览进度重试清除；关表单不误提交 | upload.maxMB及频率/归属 | upload、users/me、后台profile | UploadAsset.ownerId/url→User.avatarUrl；uploads管文件accounts管引用 | 他人资源拒绝，清除后默认头像 |
| A03 已有后端 | 管理员编辑持有版本，冲突提示刷新 | accounts.read/manage、修改理由 | 后台profile | accountVersion及审计；admin-profile-service | 两人同时改旧版本拒绝 |
| A04 已有待交互 | 用户详情资料/状态/资产/规则分区 | 管理权限与状态服务 | GET/PATCH admin/accounts/{id}；profile独立 | management-service管状态，profile不改email/tier/coins | 改昵称不改变金币状态 |
| A05 部分 | 阅读/屏蔽设置加载空值失败分开，重试 | 个人偏好，非全局审核禁词 | users/me | readingMode/bannedWords；reader-preferences→chat；accounts | 401/500断网结束转圈，刷新保留 |
| A06 已有基础 | 快捷语增删改排序预览、插入保草稿 | 个人shortcuts，限制共享契约 | users/me shortcuts | User.shortcuts；profile管理chat消费/preferences | 刷新一致，无效JSON超限后端拒绝 |
| A07 拟新增 | 字号行距气泡发送习惯预览恢复 | 用户偏好非运营设置 | 拟扩users/me明确字段 | accounts/contracts；chat渲染；先契约再迁移 | 账号隔离，刷新保留，中文不误发 |
| A08 部分 | 邮件发送中失败冷却、过期已用区分 | 当前仅开发memory投递；拟正式适配器/站点链接；accounts.passwordMinLength | auth/password/forgot、reset、email/resend、verify、account/activate | AccountActionToken；accounts/account-recovery-service；infrastructure/email | 真实收信，令牌一次性，失败不假发送 |
| A09 已有规则 | 登录过期保草稿重登回原处 | accounts.sessionDays、limits.login.perWindow/windowSeconds | auth/login/logout/me | tokenVersion及认证基础设施；web/auth | 失效不能写，重登不丢文本 |
| A10 已有入口 | 导出注销范围与身份确认、禁止重复 | 现有关闭规则，无假删除开关 | users/me/export、close | accounts协调角色故事消息上传所属privacy流程 | 仅本人，注销令牌失效，公开内容撤回 |
| A11 已有投影 | 资产分金币/当前会员/续费/订单，来源可点 | 原领域投影，不存后台副本 | users/me、me/membership、coins/ledger；admin/accounts/{id} | User金币投影/Grant/订单账本；accounts/workflows聚合 | 同用户前后台一致，金额追来源 |
| A12 已有待完善 | 账本收入支出来源时间筛选、分页及来源跳转 | grant.signupBonusCoins/dailyCapCoins/perUserDailyCapCoins | coins/ledger；筛选cursor缺则扩 | 账本业务来源；coins与shop/coin-ledger-page | 重放不重复入账，筛选明细一致 |
| A13 已有 | 充值按真实套餐展示；关闭禁止支付但可看旧单 | PaymentCheckoutPolicy.enabled、商户和金币套餐 | coins/packages X-Checkout-Enabled/Reason；purchase；admin/payments/checkout、finance/packages | payments管开关商户，coins管套餐，shop渲染 | 维持CHECKOUT_DISABLED，API不可绕过 |
| A14 已有API | 待付确认成功失败退款状态，刷新查服务端 | 套餐快照支付政策，客户端不定到账币 | coins/orders、orders/{orderNo} | 支付订单→套餐快照→流水；payments/coins工作流 | 伪造前端成功不加币，回调仅一次 |
| A15 已有线上空 | 按目录展示月季年自定义；空为未开放，不填默认假套餐 | MembershipPlan code/name/durationDays/priceCents/benefitsJson/isActive/sortOrder/version | GET memberships；admin/memberships GET/PATCH | memberships/service；web/admin对应模块 | 启用定价前台出现，下架旧单保留 |
| A16 部分 | 对比只列可执行权益、单位范围解释 | 仅DAILY_FREE_REPLIES/CHAT_PRICE_MULTIPLIER/CHARACTER_CREATE_LIMIT | 会员目录；拟同契约补说明单位范围 | contracts/memberships/index权益注册；service拒未知码 | 未知码保存拒绝，描述等于消费 |
| A17 已有 | 当前生效与后续续费至分开，显示准确时刻 | 已购快照，不用当前售价反算 | GET me/membership | Grant.startsAt/expiresAt/status与renewalExpiresAt；memberships | 未开始不提前叠加，到期失效 |
| A18 已有 | 手动续费不暗示自动扣款，未付显示待付 | 套餐+订单冻结价格周期权益退款规则 | memberships/checkout、会员notify | MembershipOrder→PaymentOrder→Grant；memberships/payments | 重复回调不重复延长，原有效期后顺延，收款仍关 |
| A19 已有 | 基础/会员免费来源、已用剩余重置 | billing.freeDailyMessages/dayTimezone/hardDailyMessages；DAILY_FREE_REPLIES及特例 | me/quota；admin settings/会员 | allowance.ts、charge-service.ts；订单业务日费用单Usage | 硬上限不能绕过，按业务时区重置 |
| A20 已有 | 模型实际有效价与优惠来源 | billing.priceMultiplier；CHAT_PRICE_MULTIPLIER；模型币价 | quota、characters/reply-plan、ai/models | billing/price计算、charge-service记录Usage；成本与用户价分开 | 报价实扣一致，不把已有更优优惠变差 |
| A21 已有 | 角色已创建/公共上限/有效会员上限说明 | content.character.maxOwned、CHARACTER_CREATE_LIMIT；公共0不限 | 创作接口；拟补明确个人额度投影，配置读会员/settings | creator-service仅公共限额已耗尽需扩额才记Usage | 公共额度未耗不误用权益，到期不随意删角色 |
| A22 后台汇总有前台拟增 | 按订单看权益时间数量、预占/已用/释放 | 服务端事件为准，不前端自加使用数 | 后台账号会员汇总；拟扩本人会员明细分页 | Usage.orderId/userId/benefitCode/state/chargeId/idempotencyKey；memberships | RESERVED→CONSUMED或RELEASED，释放非使用 |
| A23 已有 | 退款预估列实付扣除可退截止与依据，确认重算 | Policy.refundWindowHours/usageChargePeriodHours/version及订单快照 | me/membership/refund-preview、refund；admin policy | Order快照+Usage+Refund；memberships算金额payments管渠道 | 未用全退、已用按政策扣、RESERVED阻止、边界及重试一致 |
| A24 已有 | 退款处理中失败完成真实状态，完成回读权益 | 渠道及退款状态，不前端自行撤权 | 会员refund、后台订单refund | Refund、Grant.status/revokedAt、PaymentOrder与佣金反冲 | 仅对应订单撤权，后续已付续费保自身时长 |
| A25 部分 | 超50订单加载更多；购买时名称和规则 | 已有价格权益政策快照；planName当前读关联名称，拟补快照或明确策略 | me/membership；拟游标/单订单查询 | MembershipOrder/plan/grant/refund；service当前take50 | 51条可读，改套餐不改老单规则，名称语义明确 |
| A26 已有后端 | 停用再删、引用原因、成功回读 | version/reason；仅停用且未被购买可删 | DELETE admin/memberships | Plan._count.orders与审计；service | 有单阻止并解释，旧版本冲突，无引用真删 |
| A27 已有 | 继承/特例、生效值来源到期、恢复公共 | registry userOverridable=true才可覆盖 | GET/PUT admin/accounts/{id}/settings；DELETE /settings/{key} | OperationSetting→UserSettingOverride→SettingRevision；settings | 禁止项后端拒绝，到期或删除回公共 |
| A28 已有机制 | 页面只取所需配置，失败不假参数 | registry类型范围语义；public-keys白名单 | ui-config；个性价quota专用投影 | settings/service/cache、OperationSetting、contracts | 后台修改前端后端一致，私有成本密钥不外发 |
| A29 拟完善分类 | 账号聊天计费会员角色玩法运维分区、搜索、单位0/空说明 | registry group/label/unit/description/advanced复用 | admin/settings；会员支付专属API | admin/settings组件→contracts；规则仍属原域 | 可定位，0空分清，会员不混通用JSON |
| A30 已有接口 | 未保存提示、版本冲突重读、恢复预览 | 修订权限版本；会员独立version | admin/settings/history/restore/import/import/confirm；会员PATCH | SettingRevision/审计/cache；settings | 旧版不覆盖，恢复后实际消费者更新 |
| A31 部分 | 邀请奖励佣金分开，无提现勿显示可用按钮 | growth.inviteEnabled/inviteRewardCoins；affiliate.enabled/commissionPercent/eligibleOrderTypes/settlementDelayHours/minimumWithdrawalCents | growth/invite、referrals/me；admin growth/referrals/affiliate | ReferralRelationship、Accrual/Reversal；referrals/affiliate | 退款幂等反冲，仅直接关系，不冒充可提现 |
| A32 已有待定点验 | AI供应商模型启用引用/可删原因；失败不移除UI | 模型任务scope币价成本各归其域 | admin/ai/providers/{id}、models/{id}及prices/coin-prices、角色models | ai/providers/models管生命周期，前台读可用投影 | 无引用真删，有引用解释，前台可换失效模型 |
| A33 已有 | 任务点击后真实状态结果，刷新保留、可重跑原因 | tasks.intervalMs/batchSize/maxAttempts及业务规则 | admin/tasks、tasks/{id}/run | tasks状态、apps/worker执行，不页面做事务 | 失败不假成功，重复运行受控 |
| A34 部分拟增 | 通知偏好、会员到期/资产提醒、免打扰 | 拟类别时机；取真实grant，不组件写死几天 | me/notifications及[id]；拟个人偏好/事件消费者 | memberships/coins事件→notifications去重，accounts偏好 | 关闭可选提醒后不发，续费退款不误发旧提醒 |

关键消费点：DAILY_FREE_REPLIES在billing/allowance.ts:31、charge-service.ts；CHAT_PRICE_MULTIPLIER在billing/price.ts:76及charge-service；CHARACTER_CREATE_LIMIT在characters/creator-service.ts:35，公共上限大于0且已需扩额时才记使用。预占/消费/释放对应MembershipUsage，三态必须影响退款判定。会员MONTHLY为30个24小时；本轮不改变价格、权益数值或退款政策。

后台profile只接受username/displayName/avatarUrl/version/reason，金币、邮箱、tier和状态不属该表单。公开配置白名单不含全部后台规则；个性化额度价格经业务投影返回，不能以“前后端联动”为理由公开完整配置。

证据：packages/contracts/src/memberships/index.ts、settings/registry.ts、settings/public-keys.ts；packages/backend/src/modules/memberships/service.ts、accounts/profile-service.ts、accounts/admin-profile-service.ts、settings/overrides.ts及上列billing/characters消费点。

### 11.6 补充交互与可选能力（主线程整合）

以下补足三个业务明细组之外的跨模块细节。与组内条目相同的能力沿用同一实现任务，不重复创建接口或表。

| ID | 细节/状态 | 前台行为 | 后台配置 | API | 数据关联 | 模块归属 | 验收 |
|---|---|---|---|---|---|---|---|
| X01 | 继续上一条AI回复；拟新增/P2 | 消息菜单“继续写”，只针对当前有效末条；取消保留已确认内容 | 拟配置：续写开放、长度与费用策略；复用模型预算 | 拟POST /api/conversations/[id]/messages/[messageId]/continue | 拟消息版本/扩展段关联原messageId；独立requestId，接billing | web/chat；backend/conversations；contracts；billing工作流 | 同请求重放不追加两次；不支持模型给出明确原因 |
| X02 | 带建议的定向改写；拟新增/P2 | 输入“更简短/少一些旁白”等建议；预览候选再选用 | 拟配置：允许的改写能力与上限；商业规则待定义 | 拟POST .../messages/[messageId]/suggest | 候选版本关联原消息、建议文本、生成回合；不覆盖原始正文 | conversations与版本机制共用 | 失败可保留旧回复；采纳后记忆与后续消息处理一致 |
| X03 | 回复长度与风格偏好；拟新增/P2 | 会话设置用易理解选项，说明是引导而非绝对保证 | 后台定义支持选项与模型限制；用户选值受其约束 | 拟扩PATCH /api/conversations/[id]；模型能力投影 | 拟responseStyle/lengthPreference→实际prompt/generation参数 | conversations；ai；contracts；web/chat | 切换后实际模型请求变化；不支持选项不出现假开关 |
| X04 | 流式/完整展示偏好；拟新增/P2 | 用户可选择逐字展示或生成完展示；处理中有状态 | 不增加商业参数；用户偏好，仍复用服务端流式/结算 | 拟扩PUT /api/users/me | 拟streamDisplayMode；仅表现层，不改变账单状态 | accounts偏好；web/chat；不改AI业务 | 两个模式产生同一消息和费用；切换不重复发请求 |
| X05 | 重复回复反馈与有界处理；拟新增/P2 | 菜单反馈“内容重复”；可重新生成，不伪装成新内容 | 后台定义检测范围、是否自动重试及成本承担，默认不自动增加调用 | 现有regenerate可复用；拟反馈原因扩展 | 拟反馈记录关联messageId/AI调用；重复检测结果独立于文本 | conversations；ai成本；analytics | 同一问题可追踪；任何自动重试有上限且不偷偷重复扣费 |
| X06 | 单条消息不参与后续上下文；拟新增/P2 | 菜单选择“后续不参考”；保留聊天记录并显示标记 | 后台决定是否开放；用户只改自己会话 | 拟扩PATCH消息接口，不能与删除混淆 | 拟contextIncluded；历史拼装、摘要失效范围须同步 | conversations + memory跨域工作流 | 取消参考后实际上游与摘要均不再使用；重新包含有明确行为 |
| X07 | 对角色的私人设定覆盖；拟新增/P2 | 设置中写“仅这段对话使用”，可恢复角色默认 | 后台定义允许覆盖字段和长度，不允许改角色公开资料 | 拟扩PATCH会话；GET回传本人覆盖投影 | 拟personalCharacterOverride绑定userId+conversationId；保留来源版本 | conversations；characters只读原设定 | 只影响本人该会话，不改作者角色；实际提示词使用覆盖 |
| X08 | 上下文使用说明；拟新增/P2 | 显示本轮使用的本人记忆/身份及裁剪提示，不公开私有系统提示词 | 管理员可查诊断；用户只读可公开项目 | 拟GET /api/conversations/[id]/turns/[requestId]/context-summary | 拟回合上下文来源ID摘要，不存重复明文机密 | conversations/turn-query；memory；admin诊断 | 不越权查看角色隐藏设定或密钥；引用与实际请求一致 |
| X09 | 消息翻译及原文切换；拟新增/P3 | 显式翻译、语言选择、保留原文；翻译不改剧情历史 | 后台启用语言/服务/预算，费用规则未定则不开付费 | 拟POST消息translation；独立查询结果 | 拟翻译关联原消息版本、目标语言；原文修改后缓存失效 | conversations；ai适配器；web/chat | 译文不默认作为用户原话注入；失败可恢复 |
| X10 | 长按菜单与文本选择共存；拟优化/P1 | 短按无误触；长按菜单有复制/操作；仍能选择文本 | 纯交互，无新增后台参数 | 复用消息操作API | 只保留选中messageId临时状态，不新增表 | web/chat；通用菜单组件可复用packages/ui | 触屏拖选不误触删除；菜单外点击关闭、键盘可达 |
| X11 | 新消息与阅读位置；已有基础，拟完善/P1 | 上翻时不抢滚动；显示新消息提示，点后定位最新 | 纯交互；现有底部阈值留代码，不变后台 | 现有messages分页与turn状态 | 会话内临时锚点；如跨设备读位置另定义本人字段 | 现有chat-interaction/use-chat-thread | 加载早期消息保持锚点，生成期间用户可继续回看 |
| X12 | 聊天时间分隔与消息状态；拟完善/P1 | 按日期分段，区分待发送、处理中、失败、已保存 | 时间以服务端记录为准；不可伪称角色已读 | 现有消息createdAt/turns查询，必要时补状态投影 | Message与ChatCharge/回合状态关联；客户端时间仅临时显示 | web/chat；conversations/turn-query | 切时区不改消息顺序；失败不是“对方未读” |
| X13 | 列表滚动与筛选返回恢复；已有基础，拟完善/P1 | 详情返回恢复原筛选与附近位置；首页刷新有可解释行为 | 纯交互；推荐规则仍由后端 | 现有发现URL状态、目录API；分页扩展由discover负责 | 路由/历史状态保存锚点，不为滚动新建业务表 | web/layout/navigation-history；discover | 底部导航切换、浏览器返回、详情关闭不清空条件 |
| X14 | 抽屉未保存变更；拟完善/P1 | 关闭资料/创作编辑抽屉时提示保留或放弃；只读详情不打扰 | 纯交互；编辑权限服务端保持 | 复用所属领域保存接口与version | 临时dirty状态与服务器版本区别处理 | packages/ui Dialog/Sheet；业务表单所属模块 | 点遮罩、Escape、返回行为一致；失败保留输入 |
| X15 | 字体/行距/气泡阅读偏好；已有readingMode，拟扩展/P2 | 提供少量阅读选项、即时预览和恢复默认 | 用户偏好；样式值来自统一设计变量，不提供任意CSS输入 | 拟扩PUT /api/users/me，兼容readingMode | 拟readingPreferences；账号隔离 | accounts/profile；web/profile；packages/ui token | 刷新跨页一致，长中文不挤压操作，恢复默认可靠 |
| X16 | 聊天背景个性化；拟新增/P3 | 系统背景选择或本人图片，预览文字对比；可恢复 | 后台管理可选资源与上传限额；用户选背景 | 复用上传API；拟扩会话/用户偏好 | UploadAsset归属；背景引用不会被误当聊天消息或AI输入 | uploads；accounts/conversations；web/chat | 删除背景资源有降级；私有上传不变公开图库 |
| X17 | 无障碍与减少动画；已有抽屉基础，拟统一/P1 | 焦点可见、按钮有名称、减少动态、读屏状态提示 | 跟随系统/用户设置；不需要后台运营参数 | 无需新增业务API，若跨设备偏好则扩users/me | 交互状态；不新建日志表 | packages/ui；web各业务组件 | 状态不只用颜色表达；减少动画后功能不变 |
| X18 | 网络中断与重复操作反馈；已有回合幂等，拟统一/P1 | 保留内容、显示处理中或可重试；不把超时当未保存 | 复用限流/回合期限及现有服务端状态；不另造前端结算 | 现有turns与各写接口；提交沿用requestId | 请求号→订单/消息/上传归属；组件卸载不抹掉服务端事实 | web/api-client与各领域hooks；backend幂等 | 同次重试不扣两次；明确已保存与未知状态 |
| X19 | 模型不可用切换；已有基础，拟完善/P1 | 模型下架提示可选替代和费用，用户确认后使用 | AI模型可用性/角色scope/价格来自后台；不可静默换更贵模型 | 现有 /api/ai/models、/api/characters/reply-plan、PATCH会话 | CharacterAiModel与会话aiModel；价格快照 | ai/models；characters/model-scope；billing；web/chat | 失效模型不能继续扣费发空请求；显示价格等于实际计划 |
| X20 | 语音录制、转写、播放；拟新增/P2 | 录音权限说明、取消、时长提示、可编辑转写、倍速播放 | 后台媒体支持/大小时长/预算；未配置则无假入口 | 拟媒体消息/转写API；复用upload所有权 | 拟AUDIO类型、转写任务、资源与消息；不能只加schema枚举 | conversations/attachments；uploads；ai；web/chat | 取消不发送，转写失败能重试且不重复收费，刷新可播 |
| X21 | 角色TTS与声线管理；拟新增/P3 | 保留现有浏览器朗读；云声线单独说明、生成状态和播放控制 | 后台声线许可/模型/任务预算/定价待定义 | 拟消息audio生成与查询；现有朗读无需接口 | 拟音频资产绑定消息版本和声线；文字改动使音频失效 | ai适配器；uploads；conversations；billing | 播放的是当前版本，失败不伪装生成；不等于电话 |
| X22 | 实时语音通话；拟新增/P3暂缓 | 接听/挂断、网络状态、麦克风静音、文本回顾 | 后台能力/并发/时长/费用规则完整才开放 | 拟专用媒体会话API；不能复用普通SSE冒充通话 | 拟媒体会话、时段使用记录与账本关联 | ai媒体能力成熟后独立领域；worker；web/chat | 挂断停止计费，重连不会双会话；先验证需求再投入 |
| X23 | 多人角色聊天；拟新增/P3 | 选择参与角色、发言顺序、指定发言者、退出/归档 | 后台角色数量/可用模型/预算；未确定不设售卖权益 | 拟group-conversations系列，先评估共用conversation类型 | 拟参与者、消息speakerId、成员状态；记忆归属独立定义 | conversations群聊子域；characters；billing | 配角介绍不当群聊；每条能追溯角色与费用 |
| X24 | 主动问候与免打扰；拟新增/P2 | 用户主动订阅、时间窗口、频率选择、暂停；不虚假在线 | 后台上限/模板/预算，用户偏好不能突破 | 拟订阅与计划接口；复用notifications投递 | 拟主动计划→生成任务→消息/通知；时区与去重键 | conversations主动任务；worker；notifications；accounts偏好 | 关闭后停止后续任务；重复调度不发两条；不默认收费 |
| X25 | 纪念日、陪伴记录、角色日记；拟新增/P3暂缓 | 用户可编辑日期/查看来源、删除日记；区分生成与真实记录 | 后台玩法开关/生成预算；内容可用范围明确 | 拟专属玩法查询与操作，禁止塞入用户资料任意JSON | 拟记录关联用户角色与授权会话来源；删除/注销联动 | 达到实际业务规模再建角色陪伴子域，复用memory查询 | 日记不编造真实发生；来源删除后按规则失效 |
| X26 | AI生图与视频任务；拟新增/P3暂缓 | 提示输入、进度、失败重试、结果保存/删除 | 后台模型能力/尺寸/预算/价格未配置时不可购买 | 拟生成任务API，不把上传API当生成 | 拟任务→AI调用→UploadAsset→订单使用记录 | ai；uploads；worker；billing；前端所属玩法 | 真实任务状态可查，失败释放费用，视频不只展示静态封面 |
| X27 | 个人数据控制与清理范围；拟完善/P1 | 删除会话/角色/账号前显示明确范围；导出含可用附件信息 | 后台保留策略按现有领域规则，用户端不配置删除级联 | 现有导出/删除；分享授权改造后联动撤销 | 消息、附件、记忆、故事、公开分享、账本分别列保留/失效 | accounts/privacy流程；各领域privacy/invalidation | 不只删前端列表；账务记录依规则留存，已撤销分享不可读 |
| X28 | 分享预览与撤销中心；缺口明确/P0-P1 | 用户选条、预览、确认公开；列出有效链接和撤销 | 后台分享能力/公开范围；不能默认整个会话持续公开 | 现有share需改造；拟分享记录GET/DELETE | 拟分享快照+随机token+拥有者+撤销状态；排除私有设定 | conversations分享服务；contracts；web/chat/profile | 未授权不可读；继续聊天不改变快照；撤销立即失效 |

## 12. 竞品细节到本项目规格的对应

本轮只补查三份官方功能文档，未重新做全市场排名。它们用于交互能力参考，不把工具型产品等同于排名第一的商业应用。下表“本项目安排”为设计判断，不是竞品自述。

| 官方来源 | 本轮核对的细节 | 本项目对应 | 采用边界 |
|---|---|---|---|
| [Kindroid聊天工具](https://kindroid.ai/v2/docs/chat-features-and-tools/) | 重新生成保留候选、定向修改、手动修改标识、流式偏好、重复回复处理 | C18、X02、X04、X05；消息编辑相关规格 | 先补版本/上下文/成本关系，不复制其订阅价格或收费承诺 |
| [Chub聊天页](https://docs.chub.ai/docs/the-basics/just-chatting) | 会话内角色设定覆盖、世界书绑定、模型预设、聊天导出 | X07、C44、C26；模型选择规格 | 面向普通用户减少高级参数暴露；服务端保管平台密钥 |
| [SillyTavern聊天文档](https://docs.sillytavern.app/usage/chatting/) | 消息操作菜单、继续回复、分支/检查点、上下文包含/排除、翻译 | C13、C20、D33、X01、X06、X09 | 保留日常核心操作，高级操作折叠；不让用户误编辑平台私有提示词 |
| 前次Character.AI场景/记忆资料（见第8节） | 降低开始聊天的难度、长期上下文 | D09-D10、C11、C38-C44 | 结合已有故事/记忆实现完善，避免新建重复子系统 |
| 本项目具体差异化 | 角色任务、礼物、故事章节、评理、镜像 | D19-D20、D29-D34及原F项 | 优先完善已有真实链路，再评估新增玩法 |

不是所有高阶功能都要默认展开。日常界面保留发送、建议、模型/费用与清晰反馈；编辑、版本、记忆、分享等随消息或详情展开。避免把一圈功能图标铺满输入框，让用户更不知道从何开始。

## 13. UI与交互的一致性约束

本轮应用已安装frontend-design技能的交互与表达原则；不重画UI，也不修改CSS。本规格承接用户“清新、简约、灵动、少粗黑字”的方向，后续视觉开发再按现有主题做实际屏幕验证。

- 字体以正常正文为主，标题/关键动作才强调；长聊天重可读性，不以粗体堆层级。
- 角色图与内容承担识别作用；避免给每段信息套同样卡片、装饰渐变或无意义标签。
- 高频操作就近出现；低频破坏性动作进更多菜单；说明影响后确认，不弹无意义确认框。
- 移动端短操作用底部面板；长表单用完整页面或能保留草稿的编辑抽屉。不是所有东西都塞进抽屉。
- 交互动画解释变化，如抽屉展开、状态更新；不让每条消息和每张卡片反复飞入。尊重减少动态设置。
- 错误说明“发生了什么、内容是否已保存、下一步做什么”；空态给一个有意义的动作，不用假内容填满。
- 业务费用、限制、保存状态使用服务端投影；UI的间距、字重、焦点圈定不做成几百个运营参数。
- 可点击元素在触屏上容易命中；焦点、读屏、颜色对比和键盘不遮挡作为组件默认质量，不另起无用配置系统。

## 14. 后台信息架构与前台功能对照

| 后台一级归类 | 子栏目/职责 | 对应前台 | 权威数据/规则 | 禁止交叉混写 |
|---|---|---|---|---|
| 用户与权限 | 资料、状态、资产明细、用户规则特例；管理账号/角色独立子栏目 | 个人中心、登录、偏好、账号关闭 | accounts、admin-auth、admin；资产由各领域投影 | 资料表单直接改金币/会员；用户权限与管理员角色混为一谈 |
| 角色与内容 | 角色资产、标签徽章、发布审核、评论；故事模板单独子栏目 | 发现、角色详情、创作、故事目录 | characters、creators、site-content、stories | 在前端维护另一本标签/角色目录 |
| 对话与AI | 供应商、模型能力、角色模型范围、聊天规则、记忆规则、任务模型 | 聊天、记忆、建议、媒体 | ai、conversations、memory、settings | 供应商成本等同用户币价；UI自己判断模型实际支持的媒体 |
| 会员与交易 | 套餐、可执行权益、退款政策、订单、渠道开关、对账、账本 | 会员、充值、资产、退款 | memberships、payments、billing、coins | 通用settings任意JSON替代订单/会员领域模型 |
| 社区与互动 | 圈子、帖子、评论、礼物、任务；举报申诉独立处理区 | 广场、角色互动、通知 | circles、posts、community、gifts、missions、notifications | 删除入口只有toast；审核结果仅前台隐藏 |
| 增长与推荐 | 引导兴趣、推荐策略、邀请、返佣记账、漏斗 | 首次进入、发现、邀请 | growth、discovery、referrals、affiliate、analytics | 运营排序写死页面；没有提现服务却展示可用提现 |
| 站点与运行 | 导航公告、页面内容、任务运行、维护状态、配置历史 | 全站导航、公告、错误状态 | site-content、tasks、operations、settings | 与用户个人阅读偏好混在同一大表单 |

这是后台导航规划，不要求迁移稳定API或重复建数据库。可以先通过导航分区、搜索和页面小节改善分类，保持既有领域代码路径。

## 15. 需要同时落地的跨模块关系

| 变化源 | 必须同步的消费者 | 同步规则 |
|---|---|---|
| 后台修改角色标签/名称/公开状态 | 搜索、详情、创作选择器、收藏、会话角色摘要 | 公共投影一致；下架不删除用户所有历史；无权新聊给原因 |
| 修改聊天费用或会员权益 | 模型报价、quota、发送结算、权益使用记录、退款 | 新请求采用有效规则并冻结快照；老订单/已结算费用不追溯重算 |
| 编辑/删除/切换消息版本 | 历史、AI上下文、记忆、故事事件、分享快照策略 | 原子记录影响；不能只改屏幕文本；新分享模型定义撤销/保留策略 |
| 更换用户身份或私人角色覆盖 | 本会话下一轮请求、摘要范围与设置显示 | 明确生效时间；不改公共角色或其他会话；不擅自重写旧消息 |
| 停用模型/供应商 | 模型列表、角色reply-plan、发送请求、任务队列 | 服务端再校验；需换模型时提示；不静默切更贵模型 |
| 修改公共额度或用户特例 | 用户后台详情、前台quota、实际限额判断 | 展示来源与到期；过期覆盖回退公共值；不复制三份额度 |
| 上传/删除文件 | 头像、相册、聊天附件、帖子、导出 | 校验资源归属；引用资源不任意物理删除；导出说明有效引用 |
| 完成退款/到期/续费 | 当前会员、排期、创建上限、聊天折扣、提醒、返佣 | 由领域事件/事务驱动，不让前端更新余额或提前撤销别的订单 |
| 删除账号或撤回公开内容 | 分享、通知目标、公开创作者页、上传与搜索 | 由现有privacy流程协调；账务留存与公开可见性分别处理 |

## 16. 实施包与依赖，避免边做边补结构

每一包先完成契约、参数来源、数据关系，再做后台和前台，最后只做受影响链路验证。多个包可在边界固定后并行，不建立全新通用插件框架。

1. **现有缺陷闭环包（优先）**：分享授权、引导联动、记忆状态、阅读失败、草稿账号隔离、发送/编辑限制一致、标签映射。共享数据不新增重复来源。
2. **发现与首聊包**：服务端搜索分页→推荐投影→兴趣推荐→开场选择→动态建议→漏斗事件。动态建议与正式发送分别计请求和预算。
3. **聊天可靠性与细节包**：多行输入→持久草稿/待确认请求→消息菜单→删除范围→长历史/附件导出→会话管理。复用现有幂等与滚动实现。
4. **配置与资产闭环包**：后台分组→配置来源展示→会员/模型能力投影→权益明细与订单分页→退款预估状态。收款保持关闭，先用隔离业务数据验证。
5. **上下文与内容深度包**：身份/私人覆盖→消息版本/分支→记忆来源/世界书→故事存档。先确定唯一来源、版本切换及失效策略，不让各页面独立维护状态。
6. **社区与传播包**：评论按需加载→通知目标与偏好→授权分享管理。建立在分享缺陷修复基础上。
7. **可选高成本包**：转写、角色TTS、主动互动、群聊、实时通话、生图视频。按真实用户需求选择；未知商业规则保持未开放，不为清单齐全先做占位按钮。

### 只做与变化相关的验证

本轮只改Markdown，验证文档写入/回读、结构和引用即可，不跑全站构建、全量测试或重启服务。后续修改：
- 纯布局/交互：对应组件和目标移动路径；涉及可访问性时检查相应键盘行为。
- 设置：登记→管理员保存→前台读取→服务端消费这一条链。
- 消息/记忆：目标操作的数据库与上下文测试；若改计费再跑相关计费用例。
- 会员/退款：相关权益及订单隔离用例；无需顺便重新验所有社区功能。
- 公共共享契约：运行受影响应用的类型/构建检查；不是每次都全库扫一遍。
- 保留已经有效的测试证据；只有新改动、失败或具体不确定性才扩大范围。

## 17. 本轮新增的具体差距与处理位置

| 差距 | 证据位置 | 对应规格 | 优先级 |
|---|---|---|---|
| 发现页搜索只过滤已载入数据 | web/components/discover/use-discover-data.ts；backend/modules/characters/catalog-service.ts已有查询能力 | D01-D02 | P1 |
| 推荐数量/策略前端固定 | web/components/discover/use-discover-data.ts | D05 | P1 |
| 创作人设最少字数前端40硬编码 | web/components/creator/use-creator-form.ts | D21 | P1 |
| 创作草稿键未按账号隔离 | 同上与creator-draft | D22 | P1 |
| 角色详情tag key未统一label | web/components/characters/character-detail-dialog.tsx | D13 | P1 |
| 会话列表固定最多200，无列表游标 | backend/modules/conversations/conversation-service.ts | C33-C34 | P1/P2 |
| 消息导出不包含新attachments | 同上readConversationExport；web/chat-history-page | C25-C26 | P1 |
| 编辑消息4000与发送配置上限来源不同 | backend/modules/conversations/message-service.ts；contracts/settings/registry.ts | C16 | P1 |
| 新建记忆来源校验需补 | backend/modules/memory/fact-service.ts及schema.prisma | C41 | 开放新增入口前P1 |
| 会员订单只取50条且名称读当前套餐 | backend/modules/memberships/service.ts | A25 | P2 |
| 圈子逐帖并发读评论 | web/components/community/circle-feed.tsx | D38 | P2 |

上表是本轮定点检查发现，并非这些条目已经修复。完整路径分别以 apps/ 或 packages/ 开始；按相同现有目录修改，不新建根目录脚本处理业务。


## 18. P0/P1实施记录（2026-10-25）

> 第1–17节保留扫描基线与分级规格，不表示当前版本仍存在全部旧缺口。本节记录实际代码变化和验证边界；P2/P3没有伪装为本轮已完成。所有实施、构建和数据测试均在服务器候选发布目录执行，未使用本地项目副本。正式收款维持关闭。

### 已落地的模块与数据链

| 对应规格 | 实际实现 | 后台与权威数据 | 代码归属 |
|---|---|---|---|
| I01/F049–F050/C27/X28 | 选条预览、逐条版本校验、确认后生成固定快照、随机分享地址、列表与撤销；旧会话ID不能公开读；原文改删/账号关闭/角色下架使链接失效；不公开私人标题、备注、设定、附件或之后的新消息 | chat.shareMaxMessages；ConversationShare与源消息摘要；POST必须提交所选消息版本 | conversations/share-service；contracts/conversations/sharing；API conversations/[id]/share及public-conversations；web/chat与share/chat |
| I02/D01–D02/D05/D09–D10 | 服务端全目录搜索、重复tag交集、稳定分页；CMS推荐投影；兴趣即时预览不提前完成引导；开场选择可编辑，进入聊天只填草稿 | discovery.railLimit/recommendationStrategy、growth.recommendationLimit/openingSuggestions；Tag/HomeSection/Character及onboarding | characters/catalog-service、growth/onboarding-service、workflows/discover-projection；web/discover/growth |
| D13/D21–D22/X14 | 标签key映射后台名称；移除前端独有40字限制；上传读后台上限；创作草稿按账号及编辑对象隔离；未保存退出保护 | character校验契约、upload.maxMB、本人角色和上传归属 | web/characters/creator；characters/creator-service与uploads |
| C01–C06/F008–F009 | 多行自动高度、中文输入法保护、桌面发送/换行与触屏换行；账号/会话草稿持久化；刷新后按原请求查回执再恢复 | chat.maxMessageChars；GenerationCharge请求回执 | web/chat/chat-composer、use-chat-turns；conversations/turn查询 |
| C11/F005 | 真实模型生成接话建议、换一批、插入后可编辑、不代发；与聊天免费次数、金币分开；幂等结果持久化 | chat.suggestions.*、ai.taskModel.chatSuggestions、budget.task.chatSuggestions、prompt.chatSuggestions；ChatSuggestionRequest/AiCall；billing.dayTimezone日界线 | conversations/suggestion-service、ai任务模型与预算；contracts/conversations/suggestions；web/chat |
| C13–C19/C23–C26/X10–X12 | 原生选字与显式更多菜单共存；复制失败反馈；编辑/删除说明后续历史影响；日期与实际发送状态；回看不抢滚动；历史分页和附件；TXT/JSON导出附件引用 | 消息服务拥有者校验、统一chat.maxMessageChars、源消息/附件与派生记忆故事失效 | web/chat；conversations/message-service与export |
| C33/C35/X19/X27 | 会话全量名称搜索与游标分页；私人备注说明；模型选项展示服务端有效费用、换模确认、失效显式模型在收费前拒绝；删除真实清理记忆与分享，保留应留账务记录 | Conversation、MemoryFact、AiModel与quoteReplyPrice；原有费用账本 | conversations/conversation-service/chat-application-service；API ai/models；web/chat |
| I03/C38–C40 | 记忆关闭、空、失败独立；失败重试；确认转已生效，立即可见；切会话不显示旧结果 | memory开关、MemoryFact状态与实际上下文注入 | web/chat/memory-panel；既有memory领域 |
| I04/C36–C37 | 关系模式实际进入上游上下文；后台等级/成长值；成功新回合幂等成长与记录；用户API不得任意改分；前台解释来源 | relationship.romanceLevels/intimacyLevels/romancePerReply/intimacyPerReply、prompt.relationshipMode；ConversationRelationshipEvent | contracts/conversations/relationship；conversations/relationship-service；web/chat/relationship-panel |
| I05/A01–A05/F052–F053 | 前台资料修改/头像清除预览，失败保输入；后台版本冲突不覆盖；阅读设置错误可重试；头像必须是本人受管资源 | User/accountVersion/UploadAsset；原有accounts.read/manage权限 | accounts/profile-service/admin-profile-service；web/profile；admin/accounts |
| A16/A21–A22 | 权益单位、说明、范围由共享可执行权益定义给前后台；个人订单权益明细按需分页，区分预占/使用/释放；创作额度显示公共/会员及有效来源 | MembershipPlan/Order/Usage/Grant；本人usage API与creation-quota投影；不复制订单规则 | contracts/memberships；memberships/service；characters/creator-service；web/memberships/creator；admin/memberships |
| A29/F065–F066 | 聊天分享/建议/成长、发现推荐、上传、费用等设置分小节；小数可编辑；新任务模型引用也阻止误删AI模型 | 原registry/settings修订与AI引用，不新建第二套设置 | admin/settings；contracts/settings；ai/models/management-service |
| F006 | 原有运营报表新增首聊打开→首轮→第三轮→成熟次日回访；前端只能上报访问类事件，不能伪造完成；只认无取消原因的成功落库回执 | ProductEvent、GenerationCharge、UserActivityDay；明确UTC口径和开始追踪时间，不补造旧数据 | analytics/product-events-service、product-funnel-report-service；contracts/analytics；admin/analytics |
| F007相关实测缺陷 | 免费聊天也保存零金额回执，防同请求重复调用模型和重复落消息；免费取消不占免费取消次数 | 原GenerationCharge状态机；FREE_MODE coins=0，不扣币、不占聊天免费次数 | billing/charge-service、cancel；conversations现有事务 |

### 开放条件与未完成的外部配置

- 真实收款：保持PaymentCheckoutPolicy关闭，公开套餐响应继续为CHECKOUT_DISABLED；本轮未调用真实支付、退款或真实收费模型。
- 接话建议：实现真实接口与消费链，但默认关闭；管理员需配置任务模型、正数任务预算、每日次数和启用开关。不会替运营方虚构价格或开放额度。
- 关系成长：等级默认空、每回合增量默认0。配置前明确显示未配置，不继续展示占位等级；后台设定后服务端真实消费。
- I06/A08/F054邮件：已实现Resend生产适配器、重置/验证/激活链接、超时、幂等键和错误反馈；已有令牌一次性/过期/会话撤销测试。线上尚无RESEND_API_KEY与ACCOUNT_EMAIL_FROM；用户已确认邮件服务后续再接，本轮保持未启用，不标记实际投递成功。接口依据[Resend发信文档](https://resend.com/docs/api-reference/emails/send-email)与[幂等文档](https://resend.com/docs/dashboard/emails/idempotency-keys)。凭据只进服务器环境，不进前台设置或本报告。
- 会员月/季/年价格、权益和退款参数继续由原会员后台维护；未擅自创建可售套餐、开启收款或编造商业参数。

### 验证记录

- 已通过：类型检查；926个源文件的应用隔离/共享契约/前后端边界检查。
- 已通过：分享授权/快照/撤销/源变更；兴趣推荐与开场配置；接话任务预算/幂等/业务日及205会话分页；关系提示词与幂等成长、免费回执/取消；账号资产与本人权益分页/权限/创作额度；账号恢复令牌与邮件协议模拟；AI删除依赖；附件导出；记忆注入；编辑删除故事失效；后台设置分组与小数。
- 已通过：5项会员计费关联用例，包括真实优惠报价与使用记录、退款在途回退、优惠不变差、预占阻止退款与释放恢复资格。均临时SQLite和模拟上游，无真实收费。
- API、管理端、前台生产构建均通过。浏览器6组操作链通过：阅读失败重试与保存、资料修改清除头像与刷新、真实订单权益明细与游标分页、手机多行/草稿恢复/原生选字/菜单焦点/日期状态、分享选择快照与撤销、管理员独立登录/用户资料关联/后台参数保存后前台读取/权益所有权。
- 浏览器配置采用服务器临时数据库、与生产相同的WAL模式；为故障注入关闭测试上下文Service Worker。本轮没有声称验证PWA离线能力。充值目录直连9ms、代理18ms返回200和关闭标记；客户端读取开关后完整消费响应体。
- 首聊漏斗追加验证：已结算但用户取消的部分回复不计首轮/第三轮；客户端伪造完成事件拒绝。新增与关联定向用例通过，未重复扫描全站业务。
- 已上线：current指向服务器releases/p0-p1-20261025；仅应用1条新增迁移，迁移总数57→58，新增分享、建议请求、关系事件3张表；无seed/reset。用户24、会话4、消息15、会员订单0、支付订单16在切换前后不变；worker仅1个进程。
- 线上复核：运行状态、发现投影、会员目录、聊天与独立后台登录返回200；未授权会员明细401；无授权分享404；充值开关false/CHECKOUT_DISABLED。外部邮件真实投递仍待配置。
- 代码与本文档通过已授权GitHub连接同步；服务器未配置Git HTTPS凭据，因此不在服务器保存额外令牌。最终提交可从本文件所属GitHub提交记录追溯。

历史基线中已存在且本轮未改动的故事生命周期、举报申诉、订单支付回调等不再重写；沿用原领域实现。没有把页面可打开当成功验证，也不把未调用过的外部服务写成已验收。
