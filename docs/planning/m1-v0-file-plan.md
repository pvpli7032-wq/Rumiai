# M1 / V0 文件级实施计划

> 只读源码盘点后的实施建议。本任务只交付本文档；不改业务代码、Prisma schema 或数据库。V0 不新增业务表，场景内容是随版本发布的审核静态配置；不做运行时抓取、模型生成或持久章节状态。

## 1. 架构结论与开工门

领域逻辑放 src/lib/stories/，业务组件放 src/components/stories/ 和 src/components/chat/，src/app/**/page.tsx 只装配数据、现有 API 和回调。复用角色详情 API、会话创建/复用 API、现有聊天与 src/components/ui 原语。

线上目前只有 xingban-original-0..5；闻舟、许棠、陆遥不是线上 Character。禁止猜测角色 ID 或把内容映射到相似角色。发布前内容/角色负责人必须提供每人的真实 Character.id，确认公开、审核通过，且其 scenario/roleTemplate 与场景兼容。缺 ID、不可见、未审核、配置缺失或不兼容时，隐藏 V0 场景入口，保留旧角色详情/自由聊天，不建会话、不补文案、不自动发消息。此项未闭合前三角色的 V0 入口不可验收。

现有 Character 字段：id、name、tagline、personality、background、greeting、roleTemplate、scenario、tags、avatarUrl。公开角色列表读取 id/name/tagline/greeting/personality/avatarUrl/chatCount/tags；详情 API 读取完整角色并执行可见性授权。id 是配置唯一绑定键；name/tagline/tags/avatarUrl 仅作公开身份呈现；greeting 仅是旧聊天问候，可经审核复制为公开 opening；personality/background 用作原角色资料；scenario/roleTemplate 只用于兼容审查。身份、冲突、目标、建议动作、场景版本、公开问题和场景素材均为新静态配置字段，不写回 Character。

POST /api/conversations 接受 characterId、newChat；newChat=true 创建新会话，否则复用该用户该角色最近未归档会话。没有 sceneId 或故事实例语义。若同一角色的旧 scenario 与新场景不兼容，不显示场景开始 CTA；不得用 query 参数声称后端上下文已切换。V0 结束只在页面内暂存，不持久化；没有已发布后续章节目录，因此不显示下一章。

源码核对：src/app/(app)/chat/page.tsx 是客户端主流程，持有角色/会话/消息加载、输入草稿、SSE、错误和编辑/重生成；空会话 greeting 在 messages.length===0 分支。src/app/(app)/discover/page.tsx 组装角色流；src/components/character-detail-dialog.tsx 负责发现页角色弹层和开始/新建聊天动作；src/app/[locale]/character/[id]/page.tsx 是公开 Server Component 详情。角色 API 与 conversations API 路由保持不变。

## 2. 领域层文件及导出签名

### src/lib/stories/scene-config.ts

仅存公开、已审定静态内容；浏览器可导入，不含隐藏真相、提示词、审核备注或用户数据。三个建议稳定 ID：no-unsent-records-ch01（闻舟）、watch-stopped-at-0017-ch01（许棠）、unsigned-request-ch01（陆遥）。characterId 必须由上线真实 ID 填入，不可由名字推导。

type SceneConfig = {
  id: string; version: string; characterId: string; enabled: boolean;
  title: string; hook: string; userIdentity: string; conflict: string; goal: string;
  opening?: string; publicOpenQuestions?: readonly string[];
  imageUrl?: string; estimatedMinutes?: number;
  suggestions: readonly { id: string; text: string }[];
  compatibility: { approvedCharacterScenarioVersion: string; reviewedAt: string };
};
export const SCENE_CONFIGS: readonly SceneConfig[];
export function getSceneConfigByCharacterId(id: string): SceneConfig | undefined;

三个内容对象采用同一真实结构，但当前内容纲要明确是规划示例而非生产内容，不能直接当审核文案。每个配置需要实际 ID、版本、完整身份/冲突/目标、经审核公开问题和恰好三条带稳定 suggestion id 的动作。场景纲要/建议动作由内容负责人签核后填值。compatibility 是静态审定标识，不是数据库字段；需明确版本如何与线上角色设定核验，不能假称程序自动知道内容审核状态。同一 Character.id 在一个发布版本最多绑定一个场景。发布前检查 ID/scene id 唯一、字段齐全、enabled、建议条数和 ID 唯一。

结构示例仅说明形状，非可发布内容：

    {
      id: 'no-unsent-records-ch01', version: 'v0.1.0',
      characterId: '<真实 Character.id，未提供前不启用>', enabled: false,
      title: '《没有寄出的唱片》· 封面上的字迹',
      hook: '<审核钩子>', userIdentity: '<审核身份>',
      conflict: '<审核冲突>', goal: '<审核目标>',
      suggestions: [
        { id: 'ask-about-handwriting', text: '<审核动作一>' },
        { id: 'listen-to-record', text: '<审核动作二>' },
        { id: 'ask-to-keep-record', text: '<审核动作三>' }
      ],
      compatibility: { approvedCharacterScenarioVersion: '<审核版本>', reviewedAt: '<ISO 日期>' }
    }

### src/lib/stories/scene-service.ts

纯逻辑，无网络/DB/React，不从 personality 或 background 推导剧情。

    export type SceneAvailability =
      | { kind: 'available'; scene: SceneConfig }
      | { kind: 'unavailable'; reason: 'missing-config' | 'disabled' | 'incomplete-copy' | 'incompatible-character' };
    export type CharacterPublicFields = Pick<Character,
      'id' | 'name' | 'tagline' | 'personality' | 'background' | 'greeting' |
      'roleTemplate' | 'scenario' | 'tags' | 'avatarUrl'>;
    export function resolveScene(character: CharacterPublicFields, config?: SceneConfig): SceneAvailability;
    export function isSceneEntryComplete(config: SceneConfig): boolean;
    export function getPublishedSceneConfigs(): readonly SceneConfig[];

resolveScene 核对绑定 ID、完整文案、enabled 与声明兼容状态。Character 类型仅表示 API DTO 的窄投影，不把 Prisma 行传到组件。若无法验证场景和线上角色设定版本，兼容判断需人工签核后才能开放。

### src/lib/stories/chapter-close.ts

纯函数筛选当前授权会话中已保存的真实消息；不总结、不判定完成、不写入。

    export type StoryMessage = Pick<ChatMessage, 'id' | 'role' | 'content' | 'createdAt'>;
    export type ChapterCloseData = { excerpts: readonly StoryMessage[]; openQuestions: readonly string[] };
    export function buildChapterCloseData(
      messages: readonly StoryMessage[],
      scene?: Pick<SceneConfig, 'publicOpenQuestions'>,
      maxExcerpts?: number
    ): ChapterCloseData;

按 API 顺序从尾部挑 1–3 条并仅在展示时截断；公开问题只来自审核配置，没有依据为空列表。不得存到 Conversation.notes。

## 3. 组件层文件、props 与状态

| 新文件 | 类型级 props | 状态归属 / server-client |
|---|---|---|
| src/components/stories/story-card.tsx | StoryCard({scene: Pick<SceneConfig,'id'|'title'|'hook'|'imageUrl'>, character: Pick<CharacterPublicFields,'id'|'name'|'avatarUrl'>, href: string}): JSX.Element | 无状态 Server Component；Link 与现有 Card/Avatar/Button。 |
| src/components/stories/scene-header.tsx | SceneHeader({scene: SceneConfig, character: Pick<CharacterPublicFields,'id'|'name'|'tagline'|'avatarUrl'>, mode: 'start'|'continue'|'unavailable', onStart?: () => void, onContinue?: () => void}): JSX.Element | 按钮回调需要 Client Component，文件标 use client；路由页只传公开 DTO。 |
| src/components/stories/scene-entry-state.tsx | SceneEntryState({state: 'empty'|'loading'|'error'|'forbidden'|'unavailable', onRetry?: () => void, fallbackHref?: string}): JSX.Element | Client 仅因重试回调；若删回调可改 Server。组合 EmptyState/ErrorState/Skeleton。 |
| src/components/stories/chapter-close.tsx | ChapterClose({data: ChapterCloseData, characterName: string, returnHref: string, onReturn: () => void, onRetry?: () => void, loadState: 'ready'|'loading'|'error'|'forbidden'}): JSX.Element | Client；展示状态归组件，消息数据/授权归页面/API。Forbidden 时不展示缓存正文。 |
| src/components/stories/end-chapter-dialog.tsx | EndChapterDialog({open: boolean, onCancel: () => void, onConfirm: () => void, busy?: boolean}): JSX.Element | Client；Dialog + Button 组合。调用方管理焦点初始/恢复，原 Dialog 未实现完整 focus trap 保证。 |
| src/components/chat/action-suggestions.tsx | ActionSuggestions({suggestions: SceneConfig['suggestions'], onSelect: (text: string) => void, disabled?: boolean}): JSX.Element | null | Client；不持有草稿、不请求、不发送，只通知页面。 |

现有 UI 原语位于 src/components/ui/index.ts：Button、Card、Avatar、Badge、EmptyState、ErrorState、Skeleton、Dialog 等。不要新增可由这些原语组合出来的通用组件，不假设 Dialog 自动恢复焦点。

## 4. 接线文件与改动前后

| 文件与区域 | 改动前 → 改动后 | 为什么必须改 |
|---|---|---|
| src/app/(app)/discover/page.tsx：imports、角色 card/内容流组装区域 | 只从 Character API 组装普通热门/新角色 → 用静态配置 characterId 与已加载可见 Character 的交集渲染 StoryCard；普通角色流保持原样 | 配置不会由角色 API 返回；不能从不存在的三位线上角色假造场景入口。 |
| src/app/[locale]/character/[id]/page.tsx：读取角色之后、article 标题及 CTA 区 | 公开角色详情 → resolveScene 后仅对合格角色组装身份/冲突/目标 SceneHeader；缺配置保留旧详情 | 用户需要在进入聊天前看到经审核场景信息；保留公开详情与旧链接。CTA 的登录/语言路由必须沿用实测现有路径。 |
| src/components/character-detail-dialog.tsx：startChat 与第 284–297 行动作区 | 通用开始/新建聊天 → 完整兼容场景角色显示场景动作，否则保留旧动作 | 发现页主要交互在对话框，不能只改公开详情页。新建需显式传 new=1；不能静默创建错误上下文。 |
| src/app/(app)/chat/page.tsx：scene 参数/配置 resolve、messages 空态约 379–389、建议区与 composer 约 470–510、页面装配末尾 | greeting 空态和独立草稿 → 有效场景空会话展示 opening/ActionSuggestions；选择只更新既有受控 input；明确结束按钮确认后以内存状态显示 ChapterClose；回跳同一 conversationId | Composer 草稿、发送/SSE、消息与路由状态当前属于此页面。页面仅编排，不容纳配置文本或片段业务规则。保留 sendMessage、额度、流式、编辑、重生成实现。 |
| src/app/api/characters/[id]/route.ts | 不改 | 继续复用 readCharacterDetail 与可见性校验；不把静态配置合并进 API 契约。 |
| src/app/api/conversations/**、src/lib/conversations/**、prisma/schema.prisma | 不改 | V0 使用旧 create/reuse、授权消息读写；无 sceneId、完成状态、故事表。 |

建议动作 UX 规格有边界冲突：要求有草稿时追加到光标，但验收也要求可清空/改选。实施前需固定非覆盖规则并补测试。最低行为：空稿填入；非空稿不得覆盖，若不能可靠插入则按批准的追加/确认规则处理；任何选择都不发送请求。只有用户点击原发送才走现有 SSE。

## 5. 删除清单（仅候选，不在本任务删除）

- src/app/(app)/chat/page.tsx：messages.length===0 的 CharacterAvatar + greeting/通用问候分支是已绑定、配置完整 V0 场景的取代候选。必须保留未配置角色的旧 greeting/fallback，不能删整个空态。
- src/components/character-detail-dialog.tsx：合格场景角色的重复“开始聊天/新建聊天”按钮可被 SceneHeader 场景 CTA 条件化取代；普通角色动作和详情弹层其余功能不能删。
- src/app/(app)/discover/page.tsx：无可确认死代码。保留普通角色列表/筛选，StoryCard 是额外内容入口，不应以故事卡取代自由发现。
- src/components/chat/message-actions.tsx、roleplay-text.tsx、relationship-panel.tsx、hidden-reply.tsx：仍服务旧聊天，不是 V0 死代码。
- src/app/[locale]/character/[id]/page.tsx：保留旧详情与 locale URL，不删除。

目前没有可确认整文件删除项。只有 chat 空态分支的场景条件化替换及详情弹层重复 CTA 候选，须实现并回归验证后再清理。

## 6. 模块越界反例与风险

1. 反例：把静态文本、角色兼容、建议动作、消息筛选和结束确认全塞 page.tsx。正确：配置在 scene-config，解析在 scene-service，回顾纯函数在 chapter-close，UI 在业务组件，页面只传 props/回调。
2. 反例：SceneHeader 直接读 Prisma、验证权限或 POST 会话。正确：通过现有角色详情 API/目录服务取得授权角色，由页面导航至现有 chat 创建/复用流程；不在展示组件内复制授权与持久化。
3. 反例：将新身份/冲突/目标写到 Character.scenario/roleTemplate，或客户端覆盖全局角色设定。正确：新增字段仅在版本化静态配置，检查兼容，不兼容就关闭场景入口。
4. 反例：用 Conversation.notes、CharacterQuest、relationshipStatus 伪装结束状态/未完成问题，或点建议自动发消息。正确：结束状态是页面临时状态；建议只改 Composer 草稿；绝不新增写入/计费副作用。

其他风险：无真实角色 ID 阻塞绑定；同角色会话不关联 scene，不能安全切换冲突设定；结束页刷新不恢复；当前无已核验后续章目录；消息 API 返回真实正文，分析不得记录正文/草稿/建议文本。规划要求的埋点设施尚未核实，应待设施和白名单确认后另列文件，不自行新增分析系统。

## 7. 文件级改动清单

业务实现阶段新建：
- src/lib/stories/scene-config.ts
- src/lib/stories/scene-service.ts
- src/lib/stories/chapter-close.ts
- src/components/stories/story-card.tsx
- src/components/stories/scene-header.tsx
- src/components/stories/scene-entry-state.tsx
- src/components/stories/chapter-close.tsx
- src/components/stories/end-chapter-dialog.tsx
- src/components/chat/action-suggestions.tsx

业务实现阶段修改：
- src/app/(app)/discover/page.tsx：合格静态场景配置与可见角色交集、精选卡装配。
- src/app/[locale]/character/[id]/page.tsx：合格角色详情场景头部/CTA。
- src/components/character-detail-dialog.tsx：场景 CTA 条件化，普通角色保留原动作。
- src/app/(app)/chat/page.tsx：开场、建议草稿、主动结束确认与临时结束视图编排。

明确不修改：prisma/schema.prisma、prisma/migrations/**、src/app/api/characters/[id]/route.ts、src/app/api/conversations/**、src/lib/conversations/**、src/components/ui/**。

本次交付只有 docs/planning/m1-v0-file-plan.md；以上代码清单均为后续实施计划，不是本次修改。
