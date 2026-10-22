# 验收记录

> 对应 V3 终稿表 25「上线前八组检查」。本记录针对 `commercial-refactor` 分支当前 HEAD（`package.json` 0.2.0）的发布候选；所有数字都是本机实跑结果，不是预估。**表里的构建与测试数字需在发布候选的最终 HEAD 上复跑一次**——本文件不钉死某个 commit，避免验收后又改代码导致记录与实际脱节。
> 复跑命令：`npm run test:commercial` / `npm run verify:build` / `npm run verify:admin:responsive` / `node --import tsx --test tests/sqlite-backup.test.mjs` / `node --import tsx --test tests/state-recovery-runtime.test.mjs`。
> **前置条件**：`tests/state-recovery-runtime.test.mjs` 会硬断言 `.next-validation-build/BUILD_ID` 存在，所以它必须在 `npm run verify:build` 之后跑；构建产物是临时目录，跑完即删，单独跑这个用例会以「先生成生产构建目录」失败。

## 0. 本轮实跑汇总

| 命令 | 结果 |
|---|---|
| `npm run test:commercial` | **226 tests / 226 pass / 0 fail / 0 skipped**（20 个测试文件） |
| `npm run verify:build` | **通过**：产物 `.next-validation-build`，BUILD_ID `9vl28mYSz2AnXws7mgM04` |
| `npm run verify:admin:responsive` | **通过**：24 组（6 页 × 360/390/1280/1440px），不合格 0 组 |
| `node --import tsx --test tests/sqlite-backup.test.mjs` | **6 tests / 6 pass / 0 fail** |
| `node --import tsx --test tests/state-recovery-runtime.test.mjs` | **1 test / 1 pass** |

## 1. 配置保存

| 项 | 内容 |
|---|---|
| 通过条件 | 改值后实际请求改变，刷新和重启仍保留；同一项只有一个编辑位置 |
| 证据 | `tests/settings-runtime.test.mjs` 5 条全过：`发帖字数上限：改设置后同一段内容从拒绝变通过，再改回又拒绝`、`角色名称上限：改设置后校验按新值执行`、`注册：密码位数与注册赠币按设置执行`、`每日请求上限：0 表示暂停新请求，改大后同一天继续放行`、`聊天规则：发送次数与窗口长度来自设置，不是环境变量`；`tests/settings-transfer.test.mjs › 分组 PATCH 行为不变：写入、版本冲突、跨组拒绝、历史记录`。单一编辑位置（grep 实测）：UI 只有 `src/app/(admin)/admin/settings/page.tsx` → `src/components/admin/settings/settings-center.tsx`；写路由只有 `src/app/api/admin/settings/route.ts`（PATCH）与 `restore/route.ts`；写服务只有 `src/lib/settings/service.ts` 的 `saveGroup`/`restoreRevision` |
| 结论 | **通过** |
| 缺口 | 无。「重启后仍保留」有进程级证据：`tests/settings-runtime.test.mjs › 配置在全新进程里仍读得到保存值` 用 `spawnSync` 起一个全新 node 进程（不共享内存），连同一个库读回 `billing.priceMultiplier=1300`，且断言它不等于登记默认值 1000，证明确实来自数据库而不是 default 分支 |

## 2. 用户覆盖

| 项 | 内容 |
|---|---|
| 通过条件 | 特例只影响该用户，到期后恢复公共值 |
| 证据 | `tests/billing-charge.test.mjs › 报价：ceil(coinsPerReply × 倍率 / 1000)，倍率 0 免费，业务日按 billing.dayTimezone`：给单个用户写 `userSettingOverride(billing.priceMultiplier=1500)` 后该用户报价 20→30 币；`tests/settings-transfer.test.mjs › 导出：只含登记表的公共值，不含用户特例与任何凭据字段`：有 USER 覆盖时导出仍是公共值。写入口 `src/app/api/admin/accounts/[id]/settings/route.ts`（PUT）与 `[key]/route.ts`（DELETE，回落公共值） |
| 结论 | **通过** |
| 缺口 | 无。`tests/settings-runtime.test.mjs` 三条新用例覆盖了原先缺的两个边界：① 只影响该用户——公共值 1200、给 A 设特例 0，A 读 0/USER、B 读 1200/GLOBAL，且落到真实计价 `quoteReplyPrice` 上 A 倍率 0、B 倍率 1200；② 到期回落——override 的 `expiresAt` 改成过去时间后同一行仍在表里却被跳过，读回 1200/GLOBAL；③ 删除后回落。回落判定对应 `src/lib/settings/service.ts` 的 `override.expiresAt > now`，原有实现正确，此前只实缺口 |

## 3. 后台布局

| 项 | 内容 |
|---|---|
| 通过条件 | 工作台、列表、设置、价格页桌面可读；手机常用操作无整页溢出 |
| 证据 | `npm run verify:admin:responsive`：工作台 `/admin`、用户管理 `/admin/accounts`、设置中心 `/admin/settings`、价格与成本 `/admin/ai/costs`、财务支付 `/admin/finance`、通知统计 `/admin/notifications` 在 360px 与 390px 下整页 scrollWidth 与内容区 scrollWidth 均等于 clientWidth（360/360、390/390），**不合格 0 组**，输出 `PASS 后台在 360px / 390px 下均无整页横向溢出` |
| 结论 | **通过** |
| 缺口 | 无。桌面档（1280×800 / 1440×900）已纳入同一脚本，断言三条：侧栏可见宽度 ≥200px 且文字非空（展开 256、折叠 76，折叠态必挂）、内容区宽度 ≥ 视口 − 侧栏 − 8px（实测 1024/1024 与 1184/1184，只留 8px 余量，侧栏变宽即失败）、主标题 `h1` 有实际尺寸且文字与期望一致。共 6 页 × 4 档 = 24 组 |

## 4. 聊天费用

| 项 | 内容 |
|---|---|
| 通过条件 | 成功只扣一次；失败与供应商中断释放；首个内容片段送达前取消释放，之后按规则收费，免费取消额度内释放并计数；免费次数与余额一致；重复请求不重复收费 |
| 证据 | `tests/billing-charge.test.mjs`：`成功只扣一次：HELD 条件扣余额 + 唯一负数流水，SETTLED 归类为聊天消费且不再扣`、`失败释放：唯一正数流水补回预扣一次，重复释放不再补`、`重复 requestId 不重复扣：重放返回同一费用单，消息/会话不一致直接冲突`、`免费次数：先预占，成功才消耗（free_used+1）；失败释放预占、不消耗`、`取消策略：未输出释放不占次数、有免费次数释放并占用、用完按已输出结算、RELEASE_ALWAYS 一律释放`、`取消幂等与并发：重复取消不重复退款，两次同时取消只占用一次免费额度`、`非用户原因一律释放且不吃免费取消次数；免费取消次数按业务日重置`、`聊天链路：已输出后取消按策略释放并占用一次免费取消；次数为 0 时按已输出结算`、`GET /api/me/quota 暴露取消策略与免费取消额度`、`余额不足不建单不扣币`、`关闭计费开关：不建费用单、不扣币`。汇总口径另见 `tests/charge-admin.test.mjs › 汇总：待结算/未知笔数与币数和列表口径一致，且不受分页影响` |
| 结论 | **通过** |
| 缺口 | 无 |

## 5. 异常核对

| 项 | 内容 |
|---|---|
| 通过条件 | 一次中断恢复；已保存消息可结算，未知结果不盲目退款或重发 |
| 证据 | `tests/charge-recovery-drill.test.mjs` 5 条全过：`中断恢复（已保存消息）：提交过的回合补结算，币只扣一次、不重复扣`、`中断恢复（没有已保存消息）：付费单退回余额、免费额度退回预占，各只退一次`、`中断恢复（结果不明）：落 UNKNOWN 挂账，不盲目退款也不重发`、`聊天正常路径：消息保存与结算同一个事务，单据 SETTLED 且回填 messageId 与 aiCallId`、`中断恢复（聊天事务原子性）：结算失败时消息也不落库，费用单仍 HELD，核对按没有已保存消息释放` |
| 结论 | **通过** |
| 缺口 | 无 |

## 6. Mirror 与评理

| 项 | 内容 |
|---|---|
| 通过条件 | 生成可分享；匿名按 Cookie 与 IP 限额，匿名预算用完后友好提示且聊天不受影响；一人一票，结案一次；后台可编辑规则与查看结果 |
| 证据 | Mirror：`tests/mirror-generation.test.mjs`（40 条）中 `Cookie 通道上限 1 次`、`IP 通道上限 10 次`、`两条通道取较严者`、`业务日重置`、`接口层：同一 IP 的匿名额度用完后生成返回 429，且不发起模型调用`、`上限设为 0 表示暂停，文案说「暂停」而不是「用完了」、`分享视图只有结果字段，绝不包含三题原回答`、`分享预览图只含公开字段`；`tests/ai-budget-guard.test.mjs › mirror anonymous entry closes while its budget is unset or zero, and pauses only itself`（只暂停自己，聊天不受影响）。评理：`tests/dispute-case.test.mjs`（18 条）中 `一人一票，重复提交同一选择不改票数也不计改票次数`、`并发结案只生成一次回应`、`并发投票：同一用户同时投多次只落一张票`、`并发结案：两个 worker 同时处理同一案例只生成一次回应`；`tests/playbook-e2e.test.mjs` 四条：`a. Mirror：提交 → 生成 → 保存 → 分享只给公开字段 → 隐藏/过期 404`、`b. 评理投票：一人一票、按快照允许改一次、第三次被拒、不能投自己`、`c. 结案只发生一次：并发两次结案只写一条判词、只发一次奖励`、`d. 后台改规则：新案例快照用新值，老案例快照不变`；后台查看：`tests/admin-commercial-apis.test.mjs › Mirror 结果按游标连续翻页，隐藏后状态变 HIDDEN 且不可重复隐藏`、`评理案例列表带出最近失败原因，立即结案写兜底判词` |
| 结论 | **通过** |
| 缺口 | 「匿名预算用完的友好提示」在测试里断言的是 HTTP 429 与中文文案，不是真实浏览器里的提示样式；`tests/mirror-compare.test.mjs` 覆盖对比上限与越权，但匿名预算与对比的联动没有专门用例 |

## 7. 记忆与任务

| 项 | 内容 |
|---|---|
| 通过条件 | 关闭或删除后不再注入；任务到期可运行，失败可见 |
| 证据 | `tests/background-tasks.test.mjs`（19 条）中：`上下文按预算裁剪：关闭记忆不注入，超预算先砍事实`、`关闭时摘要任务直接跳过，会话不存在也跳过`、`记忆关闭时不生成待确认事实`、`记忆默认关闭时不登记任务；打开后不到阈值也不登记`、`删除消息：该消息派生的事实与摘要同一事务内失效，之后不再注入`、`编辑消息：该消息及其之后派生的事实全部失效`、`来源消息失效后事实不再注入`、`事实按会话与用户双重隔离，别人读不到也删不掉`、`租约领取后并发不重复执行，失败按上限置 FAILED`、`巡检任务按间隔重新排期，未知类型直接置 FAILED`、`备份本身失败时抛出而不是当成功，重试用尽后置 FAILED 并在后台可见`、`事件清理按保留天数删除，保留天数每次从数据库读，改设置后下次生效` |
| 结论 | **通过** |
| 缺口 | 无 |

## 8. 最终交付

| 项 | 内容 |
|---|---|
| 通过条件 | 生产构建一次；关键流程一次；迁移与备份恢复一次 |
| 证据 | 生产构建：`npm run verify:build` 通过（`✓ Compiled successfully in 2.2min`，157/157 静态页，BUILD_ID `Svu3lJbr2U9uLeMbwRmDq`，隔离库跑完 50 个 migration）。关键流程：`tests/playbook-e2e.test.mjs` 四条 a/b/c/d 全过（见第 6 组）。迁移与备份恢复：`tests/sqlite-backup.test.mjs` **6/6 pass**；`tests/state-recovery-runtime.test.mjs` **1/1 pass**——恢复出的库与上传目录能真正 `next start` 起服务，登录、后台读、页面与图片读回、恢复后新写入、重启后会话密钥轮换全部断言通过 |
| 结论 | **通过** |
| 缺口 | 真实支付通道与真实 AI 供应商未联调（V3 第 3 章明确收缩），线上域名拨测也未做 |

## 尚未完成

1. **未做线上实测**：真实支付通道、真实 AI 供应商、生产域名拨测按 V3 第 3 章收缩范围未执行。线上只做了发布后健康检查与备份恢复演练，没有跑真实付款与真实模型计费。

## M0 至 M5 阶段退出条件与对应检查

V3 表 24 给了六个阶段的退出条件，第 225 段又要求「每阶段收尾只运行对应检查，改一个设置或页面不重新跑全站」。下表把两者对上：每个阶段写它自己的验证命令，**不是每阶段都跑 `npm run test:commercial` 全量**。

| 阶段 | 退出条件（V3 表 24 原文） | 对应检查 | 状态 |
|---|---|---|---|
| M0 现状与设计 | 确认已有故事与调用链；冻结数据库增量、配置归属、后台四类布局 | 人工核对 + `npx tsc --noEmit` | **成立** |
| M1 数据与设置 | 配置表、用户特例、分组保存、缓存；改一次参数后真实请求生效 | `tests/settings-runtime.test.mjs` + `tests/settings-transfer.test.mjs` | **成立** |
| M2 后台与前台 | 六组导航、四类版式、旧入口可达、价格额度展示 | `npm run verify:admin:responsive`（24 组）+ `tests/admin-commercial-apis.test.mjs` | **成立** |
| M3 计费接入 | 普通与故事共用费用服务；免费预占、扣费、释放、取消、重生成与核对 | `tests/billing-charge.test.mjs` + `tests/charge-recovery-drill.test.mjs` + `tests/charge-admin.test.mjs` | **成立** |
| M4 新玩法与任务 | Mirror、评理、分享、通知、基础记忆、必要埋点和任务运行 | `tests/mirror-generation.test.mjs` + `tests/mirror-compare.test.mjs` + `tests/dispute-case.test.mjs` + `tests/background-tasks.test.mjs` + `tests/notification-service.test.mjs` + `tests/notification-producers.test.mjs` + `tests/product-events.test.mjs` + `tests/playbook-e2e.test.mjs` | **成立**（故事分享仅有数据层，前门未开放） |
| M5 收尾与交付 | 一次关键流程检查；迁移、任务、回退、参数说明与剩余项 | `npm run verify:build` + `tests/sqlite-backup.test.mjs` + `tests/state-recovery-runtime.test.mjs` + `npm run verify:admin:responsive` | **成立** |

`npm run test:commercial` 是上表全部文件的合集，用于**交付前一次性回归**，不是每阶段的必跑项。

## 规格未覆盖项

以下是 32 章逐条审计后查出的、规格明确要求但代码里还没有（或只做了一部分）的项。

2026-10-22 这一轮把其中 27 条全部补完并落到线上（`commercial-20261022-c20`），逐条在「状态」列写明落地方式。**第 23 条仍是有意不做的**：三处都是版式偏好，与功能可用性无关，改价格表列数还要重排现有信息密度，收益不明。

第 6 条原本留的尾巴（`limits.login.*` 已进设置中心但登录路由没有限流）已补上：登录路由按 `x-real-ip` 分桶、每次尝试计数，超出 `limits.login.*` 返回 429 + `Retry-After`，改设置立即生效。

| # | 规格出处 | 缺什么 | 影响 | 状态 |
|---|---|---|---|---|
| 1 | §20 聊天计费 | 聊天链 requestId 只比 conversationId，同号换内容会静默回放旧结果 | 重复请求幂等与冲突语义不完整 | 已修：`generation_charges.request_hash` 记内容摘要，同号换内容返回冲突 |
| 2 | §157 账本口径 | 取消原因未写入费用单（`generation_charges.cancel_reason`） | 已输出后取消按计费的对账依据缺失 | 已修：三条取消分支都写 `cancel_reason`，五类原因常量收在 `billing/types.ts` |
| 3 | §74 / 表 4 | 费用单快照有价格与时间，缺当时的配置版本号 | 事后无法证明「这单按哪一版设置算」 | 已修：快照补七项定价键各自的设置版本 |
| 4 | §79 数据结构 | 账号导出与注销未覆盖 MirrorResult / DisputeCase / DisputeVote / ConversationMemory / MemoryFact | 导出不完整；注销后新对象残留（注销是匿名化不是删行，Cascade 不生效） | 已修：导出与注销都覆盖这五个对象；MemoryFact 无对话外键，改为显式删除 + 失效兜底 |
| 5 | §78 排序 | 结案扫描与记忆事实查询用单键 orderBy，无 ID 次序键 | 同毫秒记录顺序不稳 | 已修：结案扫描、记忆事实与摘要查询都补 `id` 次序键 |
| 6 | §203 迁移第六步 | `limits.upload/follow/report/login.*` 四个频率参数仍是 env 或模块常量 | 运营改不了，且违反表 10「不得模块级求值」 | 已修：四组都进设置中心，且四组都有真实消费者（登录路由按来源限流已接上） |
| 7 | §192 任务启动 | 只有进程内 setTimeout 轮询，无可被计划任务调用的 CLI 入口 | 进程不跑就完全没有任务执行 | 已修：`scripts/run-tasks.mjs` + `tasks:run`，可挂计划任务 |
| 8 | 表 22 邀请漏斗 | `invite_visited`、`invite_first_chat` 零生产者 | 漏斗后两环永远 0 | 已修：新增 `/api/growth/invite/visit` 落地口记访问，首次对话记转化 |
| 9 | 表 22 玩法漏斗 | 报告只组三环，分享访问与转聊天未进漏斗 | 漏斗不完整 | 已修：漏斗补 `mirror_share_viewed`、`mirror_to_chat` 等环节 |
| 10 | 表 22 财务观察 | 免费占比零实现；收费回复数取当前分页而非全量 | 指标不可用 | 已修：免费/收费占比按全量统计，不再取分页 |
| 11 | 表 19 环节 3 | `MirrorResult.chargeId` 从不写入 | 结果与费用的关联是空的 | 已修：生成成功回写 `chargeId` |
| 12 | 表 19 环节 8 | 后台恢复与删除是 disabled 按钮，无端点 | 隐藏后无法恢复 | 已修：恢复与删除接上真实端点 |
| 13 | 表 9 / §180 | 观察风格零实现；结果版式写死在前端组件 | 规格要求可配的项不可配 | 已修：`mirror.observationStyle` 与 `mirror.resultLayout`（四段/引言头图）都可配 |
| 14 | 表 22 内容供给 | Mirror 推广角色上限 6 硬编码，无「补到 20」机制；示例结果开箱 0 条 | 开箱不可用 | 已修：上限进设置项，示例结果随 seed 落库 |
| 15 | 表 15 角色详情 | 「可用模型与费用」零命中 | 用户看不到要花多少钱 | 已修：`readReplyPlan` + `/api/characters/reply-plan`，价格与预扣同一份实现 |
| 16 | 表 15 聊天页 | 「分享及评理入口」零命中 | 评理只能从 /disputes 发起 | 已修：`chat-share-dispute.tsx` 接分享与评理 |
| 17 | 表 15 公开首页 | 「他眼中的你入口」缺失 | 主线入口少一个 | 已修：首页补 Mirror 入口 |
| 18 | §150 前台体验 | 首页文案与导航读前端常量，不读站点内容；后台却宣称能管 | 后台描述与实际不符 | 已修：`site-content/home-copy.ts` 让首页文案走站点内容 |
| 19 | 表 14 财务支付 | 缺套餐/对账/商户标签，套餐表单堆在订单页；退款不在订单详情 | 违反「不把财务表单堆首页」 | 已修：五标签（订单/退款/套餐/对账/商户），退款收进订单详情抽屉 |
| 20 | 表 14 系统运行 | 缺「立即运行」与「查看日志」；只显示连通性不显示连接类型 | 运维动作缺入口 | 已修：`task-log-panel.tsx` 提供立即运行与日志，补连接类型 |
| 21 | 表 7 §82/§91 | 字段详情不显示可输入范围与更新时间 | 运营看不到边界与生效时间 | 已修：字段详情显示取值范围与更新时间 |
| 22 | 表 10 #3 | 未在界面显示「其他进程最多 15 秒刷新」 | 改完不知道何时全站生效 | 已修：界面写明缓存 15 秒 |
| 23 | 表 13 | 筛选栏无「更多筛选」折叠；价格表 8 列超 5–7；抽屉无 560px 档位 | 版式规范未落地 | **未做**：三处都是版式偏好，与功能可用性无关；改价格表列数要重排现有信息密度，收益不明，暂不投机改动 |
| 24 | 表 6 | `ai.taskModel.*` 在价格页与设置中心两处可编辑 | 违反「每项只在一个位置」 | 已修：设置中心里标 `hidden`，只在价格页编辑 |
| 25 | §12 | 内容职责角色无 settings 权限，改不了自己那部分内容参数 | 职责角色不可用 | 已修 |
| 26 | §212 | 价格来源 `source` 只写不读，编辑时回填空串 | 填了看不见等于没填 | 已修：编辑时回填 `priceSource` |
| 27 | §218 | 每币收入多套餐只取最优惠一档，无区间 | 看不出套餐价差 | 已修：给出每币收入区间 |
| 28 | 表 13/§116 | 后台默认深色且无切换入口 | 用户无法自救 | 已修：前后台都挂 `ThemeToggle`（浅色/深色/跟随系统） |
