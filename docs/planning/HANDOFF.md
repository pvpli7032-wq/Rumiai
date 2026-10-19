# 交接说明（2026-10-20 03:10）

> 目的：让接手的人不必回溯对话就能继续。所有数字与路径均为本机核对结果，不是叙述推测。

## 1. 一句话现状

V0 已上线生产并验收通过；M0 的聊天应用服务抽取与 M3 的数据模型已合入本地分支但**未部署**。
下一步是 M3 的故事 API 与服务，然后 M4 记忆闭环。

## 2. 代码位置与状态

- 工作目录：`C:\Users\42422\Desktop\ai-role-community`
- 分支：`commercial-refactor`，工作区干净
- HEAD：`2e915f7 feat(stories): M3 故事数据模型与纯增量迁移`

最近 6 个提交：

| commit | 内容 |
|---|---|
| `2e915f7` | M3：6 个故事模型 + 纯增量迁移 `20261020120000_story_run_contract` |
| `b05b65b` | M0：抽取 `chat-application-service`，两个消息路由只留 HTTP 层 |
| `391763f` | 文档：记录 V0 上线生产与内容审核闭环 |
| `ac6840a` | V0：按内容审核收紧场景文案与结束页口径 |
| `784cfad` | V0：场景卡、三条建议动作、本地章节回顾 |
| `95b5521` | 部署：兜住生产启动的构建目录，清理 tsconfig 死条目 |

## 3. 生产环境现状（已核实）

| 项 | 值 |
|---|---|
| 域名 | `https://lh.y-98.cn`，`/` 307 → `/zh` |
| 当前发布 | `commercial-20261020-c4-rc2`（BUILD_ID `tRBseGKiU88NSsGiOCagr`） |
| 部署路径 | `/www/wwwroot/khui-ai/releases/commercial-20261020-c4-rc2` |
| PM2 | 单实例 `khui-ai`，online，重启 0；3000 端口仅此一个 next-server |
| 数据库 | `/www/wwwroot/khui-ai/shared/database.db`，45 条迁移全部 applied |
| 备份 | `shared/backups/database-release-c4rc2-20261020`、`database-release-c3-20261020` |
| 回滚位 | `c3` 与 `c2` 目录均保留 |
| SSH | `ssh -i ~/.ssh/khui_deploy_ed25519 root@43.242.194.115` |

认证（2026-10-20 02:0x + 03:0x 两次核对）：`/zh`、`/discover`、`/shop`、`/api/site`、`/admin`、`/login` 全 200；匿名 `/api/admin/access` 401；旧前缀 `/api/v1/site` 404。

**注意：生产库还没有新迁移。** 6 张 story 表只存在于本地库。上线 M3 前必须按第 7 节流程走。

## 4. 三个模块各自的位置

### 4.1 V0 场景体验（已上线）
- 领域：`src/lib/stories/scene-config.ts`（三条场景静态配置）、`scene-service.ts`（`resolveScene` 四种不可用原因）、`chapter-close.ts`（真实片段提取）
- 组件：`src/components/stories/`（story-card、scene-header、scene-entry-state、chapter-close、end-chapter-dialog）、`src/components/chat/action-suggestions.tsx`
- 接线：`src/app/(app)/discover/page.tsx`、`src/components/character-detail-dialog.tsx`、`src/app/[locale]/character/[id]/page.tsx`、`src/app/(app)/chat/page.tsx`
- 测试：`tests/stories-v0.test.mjs`（5 条）、`scripts/verify-v0-story-browser.mjs`（11 条）

### 4.2 聊天应用服务（已合入，未部署）
- `src/lib/conversations/chat-application-service.ts` — `executeChatTurn()`，一次聊天回合的完整编排
- 两个路由只剩 HTTP 层：`src/app/api/conversations/[id]/messages/route.ts`（POST + 原 GET）、`.../[messageId]/regenerate/route.ts`
- 行为对照表：`docs/planning/m0-behavior-parity.md`（**改这里之前必读**）
- 测试：`tests/chat-application-service.test.mjs`（7 条）、`tests/m0-route-behavior.test.cjs`（14 条）、`tests/m2-context.test.cjs`（4 条）

### 4.3 M3 数据模型（已合入，未部署）
- `prisma/schema.prisma` 末尾 6 个模型；`prisma/migrations/20261020120000_story_run_contract/migration.sql`
- 契约：`docs/planning/m3-data-contract.md`（第 1 节模型、第 5 节 API、第 9 节拍板结论）
- 迁移已验证纯增量：`conversations`/`messages`/`users` 三表建表语句与索引前后逐字节相同，`foreign_key_check` 0 行

## 5. 验证基线（改动后用这些自证）

```
npx tsc --noEmit                                      # 类型
node scripts/check-definition-of-done.mjs             # 完成定义（8 项）
node scripts/run-production-guards.mjs                # 生产门禁 2 条
node --import tsx --test tests/chat-application-service.test.mjs tests/conversation-message.test.mjs tests/conversation-service.test.mjs
node tests/m0-route-behavior.test.cjs                 # 14 条
node --test tests/m2-context.test.cjs                 # 4 条
node --import tsx --test tests/stories-v0.test.mjs    # 5 条
node --import tsx --test tests/database-upgrade.test.mjs
DISABLE_MOCK_AI=false node scripts/run-browser-matrix.mjs test:browser   # 9 PASS / 1 SKIP
```

浏览器矩阵的几个坑（**踩过，不要再踩**）：
- 必须显式 `DISABLE_MOCK_AI=false`，否则本地 `.env` 里是 true，聊天返回 503。
- `test:m2:chat` 硬要求 18782 端口，矩阵用随机端口，跑不通是既有问题。
- `test:screenshots` 会因 `NEXT_PUBLIC_SITE_URL` 是 localhost 而 307 失败，既有问题。
- `npm test`（`tests/runner.ts`）要求 `localhost:3000` 有服务，否则 147 条全 fetch failed，不是回归。
- 发现页场景区是客户端渲染，**curl/grep HTML 永远找不到**，必须用浏览器。

## 6. 当前阻塞与已知问题

1. **生产管理员密码仍是 `123123`**，未轮换。这是线上安全缺口，优先级高于功能开发。
2. **V0 四个漏斗指标没有埋点**：开场到达率、首条消息发出率、主动结束率、结束页继续点击率。V0 上线验证的是"能跑通"，不是"漏斗有改善"，无法用数据判断 V0 是否成功。
3. **发布候选复审有一处偏差**：映雪那条公开问题改完后未再走完整复审即上线，已记在 `docs/planning/v0-acceptance-record.md`。
4. **生产环境没有 AI 密钥**：`app.env` 里 `OPENAI_API_KEY` 为空，但数据库里有 provider 记录（`ces`）和模型 `gpt-6.1-sol`，走的是后台配置的 provider。真实模型调用能否成功未验证过。

## 7. 上线 M3 的流程（必须先做）

不要直接切 c4-rc2 加新表。顺序：

1. 本地 `npm run build` + `npm run db:local` 通过
2. 打包发布目录（排除 env/db/node_modules/.next/uploads/artifacts/temp）
3. 服务器上 `npm run state:backup`（写库前备份，验证 integrity + foreignKeys）
4. **在副本上先跑迁移**：复制生产库 → 对新副本执行 `20261020120000_story_run_contract/migration.sql` → 核对记录数、`foreign_key_check`、`_prisma_migrations` = 46
5. 3100 预启动（`next start --hostname 127.0.0.1 --port 3100`），不接线上写库
6. 停写 → `release:check` → PM2 切新目录 → `pm2 save` → 断言 → 60 秒观察
7. 失败回滚：PM2 切回 c4-rc2（新表留着不用，不删）

## 8. 下一步（按序）

| 阶段 | 内容 | 写作用域 |
|---|---|---|
| M3-2 | `/api/story-runs` 端点 + `src/lib/stories/repository/**` | `src/app/api/story-runs/**`、`src/lib/stories/repository/**` |
| M3-3 | `chat-application-service` 按 `StoryRun` 存在性分流 | `src/lib/conversations/**`（串行，一次一个写入者） |
| M4 | 状态抽取 worker、章节闭环、失效事务、60 例评测 | `src/lib/stories/lifecycle/**`、`tests/story-evaluation/**` |
| M5 | 生命周期、导出删除、灰度与回退演练 | `src/lib/stories/lifecycle/**`、`docs/planning/releases/**` |

**M3-3 是唯一会碰旧发送路径的改动**，必须有普通发送与重生成的回归证据（`m0-behavior-parity.md` 逐行对照）。

## 9. 团队与文档

- 团队：lead、product-lead、software-architect、engineering-lead、ux-designer、qa-lead、devops-lead、security-lead、delivery-manager
- 规划书：`docs/planning/角色关系连续剧产品与实施规划书_完整详细版_V1.0.docx`
- 工作流文档：`docs/planning/roadmap.md`（W01–W09、M0–M5、R0–R4 发布批次）
- 纯文本版规划书：`.temp/plan-final.txt`（便于 grep，未纳入版本控制）

## 10. 工程约定（这个仓库特有的）

- 文案层不能有 `zhText`；不要写泰国字符（现有词典除外）；前台不能引用后台组件。
- 组件只用 `@/components/ui` 原语，不引新依赖。
- 不用 `localStorage` 伪装跨设备进度，不把 AI 编造的总结当数据库事实。
- 迁移只许增量，不许 `ALTER` 既有表（除非有明确批准与回滚方案）。
- 删代码要删干净：被替换的实现、死导出、临时脚本一并清掉，不留沉淀。
