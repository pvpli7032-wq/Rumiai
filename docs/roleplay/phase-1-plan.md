# 第一阶段详细开发方案

目标：保留平台结构，把“用户配置—上下文编排—真实模型请求—历史版本—导入导出”接成可验证的链。第一阶段分1A修正现有一致性、1B完成普通卡兼容；不增加脚本执行、完整插件商店、群聊或新收费方式。

## 目录与依赖

沿用仓库根目录；只在确定业务归属后添加文件。下树带“新”的项是计划，按任务实际需要创建，不提前生成空目录。

```text
apps/
  web/src/components/
    chat/                         沿用会话抽屉、上下文、世界书、身份、消息菜单
      prompt-preset-panel.tsx     新：会话提示词预设
      regex-manager.tsx           新：本人正则规则与试运行
      import-preview-panel.tsx    新：会话导入预览
    creator/character-card-import.tsx 新：角色卡导入
  admin/src/components/
    settings/                     沿用设置组与修订
    chat/prompt-template-management.tsx 新：平台模板
  api/src/app/api/                路由仅鉴权/校验/调用/响应
  worker/                        本阶段无第二套任务轮询器
packages/
  contracts/src/
    conversations/               现有context-tools；扩上下文诊断与导入DTO
    characters/cards.ts           新：卡兼容报告与字段
    prompts/                      新：提示块/预设/参数/兼容报告
    worldbooks/                   新：激活规则与转换DTO
    regex/                        新：规则/作用域/阶段/试运行DTO
  backend/src/
    modules/
      conversations/
        context/                 有效历史、上下文来源
        branches/                消息版本与记忆重映射
        import-export/            新：普通聊天JSONL转换
      characters/cards/           新：V2 JSON/PNG转换
      prompts/                    新：纯编译器、宏、预设服务
      worldbooks/activation/      新：纯激活器、来源解释
      worldbooks/import-export/   新：世界书转换
      regex/                      新：受限规则引擎和本人规则服务
      ai/                         沿用模型能力/上游请求/用量
      settings/                   沿用设置和修订
    workflows/prepare-generation.ts 新：跨模块只读快照装配
    infrastructure/ai/tokenizers/ 新：token计数适配
database/schema.prisma
database/migrations/              只追加迁移，不改已执行历史
tests/unit/                       宏/激活器/正则/格式纯函数
tests/integration/                临时SQLite与模拟上游
tests/e2e/                        前后台入口及移动端
docs/roleplay/                    当前规划与验收状态
.github/workflows/                如使用GitHub Actions，验证工作流归这里
```

纯编译器不查数据库；工作流组装各模块DTO后编译。modules不得反向依赖workflows；现有聊天应用编排若调用新工作流，需把该编排提升到workflows并保留旧服务薄兼容导出，不能制造环依赖。故事模块提供自己的输入DTO，不让通用编译器读取故事内部状态。apps/web与admin只通过HTTP；contracts不导入Prisma/Node；仅真共享基础控件放packages/ui。禁止新建根级lib/utils/temp/backup容纳业务。

## 任务与顺序

|包|开发内容、明确改动点|数据库/API/UI|验收|依赖|
|---|---|---|---|---|
|P1-01a|suggestion-service.ts读取历史添加contextIncluded过滤；隔离上游断言|无字段/API/界面变化|AC-01|0|
|P1-01b|message-service.ts与建议共用有效历史选择；buildAdvancedContext接入普通建议；故事继续显式上下文|沿用context与建议接口；来源诊断分operation|AC-02、03|01a|
|P1-01c|branches/service.ts复制MessageVersion并映射selectedVersionId；手工事实策略显式；不复制旧费用单|现有表可实现；branch响应可增加复制计数|AC-04、05|01a|
|P1-02|模型能力+tokenizer+统一预算；替换context/builder.ts的伪token计数|AiModel字段；后台模型编辑；前台预算说明|AC-06、07|01b|
|P1-03|prompts域、预设版本、确定编排顺序、角色卡字段和生成参数|PromptPreset/Revision、Conversation绑定；预设API/前后台入口|AC-08至11|02|
|P1-04|世界书激活器、基本规则、导入导出、预览解释|WorldbookEntry扩展、书version；既有worldbook接口扩展|AC-12至15|03|
|P1-05|纯宏char/user/角色资料；未识别宏告警，非递归执行|无需独立宏表；编译报告|AC-16、17|03|
|P1-06|正则规则生命周期、作用域、执行阶段、试运行|RegexRule、变换审计；本人规则API/编辑器|AC-18至21|03、05|
|P1-07|V2 JSON/PNG卡、内嵌书、预设/正则差异报告、原始扩展保留|CharacterRoleplayProfile、ImportJob；导入预览/确认/导出|AC-22至25|04、05、06|
|P1-08|普通ST JSONL导入导出、swipes与selectedVersion、元数据保留|Conversation/Message导入元数据；事务与幂等|AC-26至28|01c、07|
|P1-09|前后台联动、原场景与计费回归、迁移/回滚、样本兼容说明|设置、导航、权限、发布说明|AC-29至34|所有前项|

顺序：01a → 01b/01c → 02 → 03 → 04/05 → 06 → 07 → 08 → 09。表中可并行仅指工程依赖，不授权多代理或提前绕过验收。每包单独提交，失败先修本包，不把未验收缺陷带入下一包。

## 上下文编排契约

处理顺序固定：权限/请求号 → 读取同一有效历史与配置版本 → 输入正则 → 世界书扫描（有效历史+本轮输入）→ 纯宏展开一次 → 提示词阶段正则 → 组装role块 → token预算/裁剪 → 模型能力检查 → 原计费预占与调用 → 输出正则 → 版本持久化及结算 → 显示正则。

平台约束块 → 角色系统块 → 角色description/personality/scenario → 本人身份及会话私人补充 → beforeHistory世界书 → 对话示例 → 有效历史 → 本轮用户输入 → afterHistory世界书 → 角色post_history_instructions。每块带source/version/order；模型不支持多个system或末尾system时由适配器归一，并保留前后诊断，禁止静默改成assistant。平台不可编辑规则与用户可编辑内容分开，不允许导入卡覆盖运营权限/费用。

普通聊天、建议、续写、改写共享基础上下文；建议额外任务指令明确“以用户身份建议”，不发送消息；续写保留原回复与指令；重生成只读目标之前历史。故事使用相同编译基础但保留自己的状态输入、提交和结算流程。

旧记录没有精确token时不伪造。已确认部分文本的取消行为、费用规则和历史截断沿用当前逻辑，若变更另列迁移与验收。分支复制“当前手工事实”需返回说明，不假称恢复了分叉时点尚未记录的事实历史。

## 第一阶段兼容范围

|格式/能力|执行支持|保留但不执行/阻止|
|---|---|---|
|Card V2 JSON/PNG|基础资料、示例、多开场、系统/历史后指令、内嵌基础书|未知extensions原样保留；脚本禁执行|
|世界书|主/次关键词逻辑、常驻、大小写、整词、受限regex、扫描深度、前后位置、role、优先级、预算|递归、概率、sticky/cooldown/delay、group/outlet等第二阶段；存在活跃不支持规则时默认阻止激活|
|CC预设|已定义提示块、顺序、启停、支持的生成参数|Text Completion/Instruct、工具、任意模板暂不执行|
|正则|四阶段、三作用域、禁用、顺序、捕获组替换、试运行|执行JS、复杂不受限表达式、深度条件不支持|
|JSONL|普通聊天role/content/time、swipes、选择版本、基础metadata|群聊/故事状态不伪装导入；外链附件不自动下载|
|V3/CharX|识别并报告版本|第一阶段拒绝确认；保留上传预览直至过期|

用户必须主动选择“以降级副本导入”才能移除不支持的活跃配置；预览列出每项丢失语义与目标字段。原始文件保留在本人ImportJob，导出可回填未知字段但不能标完整兼容。普通文件的业务内容仍走既有创作审核，不把导入当公开发布。

## 配置与发布

新能力默认关闭，管理员通过既有设置服务启用；配置键、单位、限制见入口文档。预算数值由现有运营配置决定，本计划不设新价格/佣金/收费条款。真实AI和付费渠道不用于测试。

1. 在批准环境安装锁定依赖，建立临时SQLite和假上游。
2. 先跑目标用例，再typecheck与architecture:check；涉及页面做浏览器与三个应用构建。
3. 数据变更先旧库副本升级，验证行数、索引、回填及旧客户端响应兼容。不能seed/reset生产。
4. 灰度先平台自有夹具账号；确认回合诊断与计费不变，再逐功能开关启用。
5. 失败关闭新能力并回退代码；已写新数据必须保留。破坏性降级数据库不自动执行。
6. 合并、上线、生产数据库操作按仓库授权规则单独处理；开发授权不等于生产发布。
