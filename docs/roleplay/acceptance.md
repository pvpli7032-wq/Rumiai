# 第一阶段验收矩阵

以下是待执行的验收要求，不是已通过结果。每条记录提交SHA、环境、命令、输出链接、通过/失败/未运行；缺运行环境时标阻塞，不以源码阅读代替。

|ID|任务|场景|Given/When|必须满足Then|测试归属|
|---|---|---|---|---|---|
|AC-01|P1-01a|建议排除历史|历史含有效A、排除B、另一会话C；请求建议|模拟上游只含A，不含B/C；重放调用数1、消息数/聊天扣费不变|tests/integration/chat-suggestions-pagination.test.ts|
|AC-02|P1-01b|生成入口一致|同身份、私人补充、世界书绑定执行发送/建议/改写|基础来源一致；任务专用指令有区别；排除消息不用于词命中|tests/integration/chat-context-consistency.test.ts（新）|
|AC-03|P1-01b|故事边界|章节故事请求普通接口/故事建议|普通入口拒绝；故事使用已提交历史和场景设置，无重复扣费|tests/integration/story-history-invalidation.test.ts + 新一致性用例|
|AC-04|P1-01c|分支版本|分叉点之前消息有多候选与选中版本|新id映射正确；原会话不变；选中候选归属新消息；原费用不复制|tests/integration/chat-context-p2.test.ts扩展|
|AC-05|P1-01c|分支事实|手工事实、点前来源、点后来源、失效事实同时存在|当前手工事实按说明复制；点前重映射；点后/失效不复制|同上|
|AC-06|P1-02|精确与估计token|中英文emoji、不同模型、未知tokenizer|精确计数匹配固定向量；未知标estimated；预留回复不超硬窗口|tests/unit/prompt-budget.test.ts（新）|
|AC-07|P1-02|预算裁剪|超窗口与必须块过长|完整轮次裁剪可解释；必需块超限在扣费/上游前拒绝|tests/integration/prompt-budget.test.ts（新）|
|AC-08|P1-03|预设版本|两标签编辑同version；旧会话绑定旧revision|第二写409保留草稿；新revision不改变旧绑定|tests/integration/prompt-presets.test.ts（新）|
|AC-09|P1-03|编排次序|设置所有块并禁用可选块|实际上游role/order与定义完全一致；平台约束不可移除|tests/unit/prompt-compiler.test.ts + integration（新）|
|AC-10|P1-03|参数能力|可支持与不支持模型参数|支持值真实到上游；越界/不支持返回422，不悄悄忽略|tests/integration/prompt-presets.test.ts（新）|
|AC-11|P1-03|预览隐私|本人/他人/平台私有块|预览不调用AI不收费；私有明文/密钥不可见；实际诊断可对齐|同上|
|AC-12|P1-04|主次关键词|四种次词逻辑、空次词、常驻|每类命中与不命中表格夹具通过|tests/unit/worldbook-activation.test.ts（新）|
|AC-13|P1-04|扫描与匹配|大小写、Unicode整词、受限regex、scanDepth=0/1/null|只扫描定义范围；排除消息不能触发；非法regex可定位|同上|
|AC-14|P1-04|位置排序预算|多书重复绑定、同优先级、预算不足|条目只注入一次、稳定排序、裁剪说明、role正确|tests/integration/worldbook-context.test.ts（新）|
|AC-15|P1-04|导入高级规则|带递归/cooldown/group/outlet的书|列unsupported；默认不能激活，降级副本明确损失；原字段保留|tests/unit/worldbook-format.test.ts（新）|
|AC-16|P1-05|纯宏|char/user/description/personality/scenario/mesExamples及嵌套字样|只替换支持宏一次；替换结果不二次解释；未知告警|tests/unit/prompt-macros.test.ts（新）|
|AC-17|P1-05|脚本不执行|宏值含JS/EJS/HTML与反斜杠|保留为文本；无eval/网络/文件执行|同上|
|AC-18|P1-06|四阶段正则|同规则分别作用于输入/输出/prompt/display|原文与存储/请求/显示分别符合契约，不串阶段|tests/unit/regex-pipeline.test.ts（新）|
|AC-19|P1-06|范围顺序|用户+角色+会话规则及无权限规则|定义次序稳定；外人规则不可读写执行|tests/integration/regex-rules.test.ts（新）|
|AC-20|P1-06|受限表达式|不支持lookbehind/backreference及膨胀结果|保存或执行报明确错误；不退回无限回溯引擎|tests/unit/regex-engine.test.ts（新）|
|AC-21|P1-06|规则变化与历史|修改输出规则后读旧版本/重放费用|旧结果不被追改；display变化不修改持久正文|tests/integration/regex-rules.test.ts（新）|
|AC-22|P1-07|V2双向转换|JSON/PNG含多开场、示例、内嵌书、未知扩展|导入-编辑-导出-再导入规范字段等价；未知字段保留|tests/integration/character-card-import.test.ts（新）|
|AC-23|P1-07|原审核配额|导入带creatorId/公开状态/模型权限伪造字段|不覆盖平台字段；创建限额与原审核生效|同上|
|AC-24|P1-07|幂等/事务|并发确认、同号不同文件、半途写失败|仅一份实体；digest冲突409；失败无半套书/角色|tests/integration/import-jobs.test.ts（新）|
|AC-25|P1-07|格式与过期|坏PNG、超限、V3/CharX、过期任务、外链|准确错误；不下载外链；不宣称成功兼容；无公开源文件|同上|
|AC-26|P1-08|聊天版本|JSONL swipes、选中索引、同时间消息、未知metadata|顺序可回读；版本映射正确；未知数据保留；导出可往返|tests/integration/chat-jsonl.test.ts（新）|
|AC-27|P1-08|非法行全失败|中间一行缺role/content、超上限、群聊/故事文件|报告行号且确认零写入；不截断假成功|同上|
|AC-28|P1-08|导出归属|本人/他人会话、私有卡、隐藏配置|401/404及授权策略正确；无账单密钥越界数据|同上|
|AC-29|P1-09|后台到真实消费|开关/限制/model能力保存后用户操作|版本回读；前台提示与API执行一致；关功能仍可读历史/重放|tests/e2e/roleplay-settings.mjs（新）|
|AC-30|P1-09|移动端编辑链|窄屏打开、切面板、返回、换会话、保存失败|抽屉方向宽度符合既有设计；草稿保存且不串账号；焦点键盘可达|tests/e2e/roleplay-workflows.mjs（新）|
|AC-31|P1-09|旧库升级|60条历史迁移基线+代表性旧会话/角色/订单夹具|新增迁移全执行；原字段逐字保留；外键/行数/索引一致|tests/integration/migration-upgrade-validation.mjs扩展|
|AC-32|P1-09|商业链回归|发送/重放/取消/上游失败/余额不足/版本选择|原规则预占结算释放次数正确；不触发真实收款/模型|现有billing/chat tests按受影响范围|
|AC-33|P1-09|架构与构建|全部本阶段实现完成|architecture:check/typecheck/三应用build通过；无跨应用/反向依赖|现有npm脚本|
|AC-34|P1-09|兼容样本发布|最小卡/多开场/世界书/正则/预设/JSONL六类合法及非法样本|逐样本支持/保留/阻止报告；无声丢字段为失败|fixtures随tests对应域；不含第三方未授权私人卡|

## 第一项执行命令

在批准云环境或GitHub Actions使用Node 22.13+，无生产DATABASE_URL；依赖严格npm ci，之后npm run db:generate。目标命令：

```sh
node --import tsx --test tests/integration/chat-suggestions-pagination.test.ts
npm run typecheck
npm run architecture:check
```

目标集成测试使用tests/helpers/sqlite-fixture.mjs创建临时SQLite并应用历史迁移，模拟fetch只接受example.test；调用真实AI、支付、邮件即失败。这里只验证AC-01及其已有关联断言，不宣称AC-02至34通过。

其余阶段按任务新增测试后纳入package.json或工作流。现有test:chat-context只包含story-history-invalidation和chat-memory-injection，不会自动覆盖chat-context-p2.test.ts；不能只运行短脚本就声称全覆盖。新增测试必须验证真实业务行为，不用字符串包含源码替代运行。

## 第一阶段完成条件

34项行为证据齐备；涉及页面的手机/桌面关键链通过；迁移升级验证通过；三应用构建、类型与边界检查通过。没有未解释的跳过项，没有真实收费副作用，所有不支持导入语义可见且不会静默生效。阶段尚未完成时仅记录已交付任务，保持其他功能开关关闭。

## 本轮执行证据

待云端执行后更新。不沿用旧审计中的历史“通过”和线上数据库数量作为本轮证据。
