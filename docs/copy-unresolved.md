# B5 文案体系迁移：未解析清单

**结果：0 处未解析，451 处已全部映射为中文。**

## 迁移范围

| 项 | 数量 |
| --- | --- |
| `zhText("泰语原文")` 调用被替换为中文字面量 | 451 |
| 涉及源文件 | 24 |
| 未解析（无中文来源，保留原文） | 0 |
| 删除的旧模块 | `src/lib/zh-text.ts`、`src/lib/i18n/app-zh.json` |
| 新增模块 | `src/lib/copy/zh.ts`（`zhError` 与 `errorCopy`） |

调用点总数 472 = 451（本次替换）+ 16（`sidebar.tsx`）+ 4（`topbar.tsx`）+ 1（`zh-text.ts` 里的函数定义）。前两项由 Lead 负责，仓库当前已无任何 `zhText` 调用。

## 中文来源

按优先级合并，与原 `zhText()` 运行时查表逻辑完全一致，因此替换前后渲染结果相同：

1. `src/lib/i18n/app-zh.json`（泰语原文 → 中文）
2. `src/lib/i18n/dictionaries/th.json` + `zh.json`（同一 key 的泰语与中文配对）

无中文来源时 `zhText()` 原本就是恒等函数，替换时按原样保留（例如 `"..."`、`"×"`、`"MB"`、`"px"`、`""`、`"🪙"` 等非泰语符号），属于行为等价，不计入未解析。

## 迁移方式

一次性脚本扫描调用点，按上述映射求值后写成 JSON 字符串字面量（自动处理引号与换行转义）。逐处替换，不改组件结构、不改行为。

## 验证

```
npx tsc --noEmit
# 无输出，退出码 0

LC_ALL=C.UTF-8 grep -rlP '[\x{0E00}-\x{0E7F}]' src
# src/lib/i18n.ts
# src/lib/i18n/dictionaries/*.json   ← 仅 i18n 模块，按决策 D2 保留
```

注意：本机 grep 为 GNU grep 3.0，直接执行 `grep -rlP '[\x{0E00}-\x{0E7F}]'` 会报
`character value in \x{} or \o{} is too large`，需要加 `LC_ALL=C.UTF-8` 前缀才可用。

## 未纳入本任务的部分

| 位置 | 说明 |
| --- | --- |
| `src/components/sidebar.tsx`、`src/components/topbar.tsx` | 由 Lead 负责替换，本次未改动。 |
| `src/lib/i18n.ts` 的 `th` 字典、`src/lib/i18n/dictionaries/*.json` | 按建议书决策 D2 保留多语言，`/th` 公开页继续可用。 |
| `tests/`（7 个文件） | 泰语字符串是测试输入样本（用户内容、角色设定、关系状态值），不是界面文案，未改动。 |
| `scripts/`（4 个文件） | 开发者验证脚本的泰语控制台输出与 e2e 选择器，不是用户界面文案，未改动。 |
