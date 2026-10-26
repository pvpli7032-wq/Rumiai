# 前后台入口与配置联动

第一阶段沿用现有主题和右侧抽屉，不重做导航体系。新增管理入口必须登记packages/contracts/src/admin/nav.ts，与路由、权限、面包屑一致。不会为每个字段增加独立页面。

## 用户端

|入口|现有改动点/新增组件|操作与状态|API/数据|
|---|---|---|---|
|/chat → 右上⋯ → 设置 → 身份背景|chat/conversation-context-panel.tsx、persona-manager.tsx|保留身份/私人补充；新增提示预设摘要及跳转；换会话隔离草稿|现有context GET/PATCH|
|同抽屉 → 提示词预设（新增）|chat/prompt-preset-panel.tsx|列表、新建/复制、块排序/启停、role、参数、保存新版本、应用当前会话；不可编辑平台约束|/me/prompt-presets；Conversation绑定revision|
|同抽屉 → 世界书|chat/worldbook-manager.tsx|基础/高级分组；关键词、次词逻辑、常驻、扫描、位置、role；导入预览、试运行、导出|原/me/worldbooks及新增preview/import|
|同抽屉 → 文本规则（新增）|chat/regex-manager.tsx|阶段与范围选择、规则排序、开关、输入/输出差异、保存错误定位|/me/regex-rules|
|同抽屉 → 本轮上下文|conversation-context-panel.tsx或其专用子组件|来源顺序、计数质量、裁剪原因；隐藏内容仅显示元信息；预览与已生成回合分开标记|context/usage与preview|
|/creator → 创作工具 → 导入角色卡|creator/character-card-import.tsx；复用creator-form.tsx|文件→字段映射→不支持项→确认私有创建→编辑；不直接公开发布|imports两步协议、原角色创建|
|/creator → 角色高级设定|creator/creator-steps.tsx、fields.tsx|多开场、示例、系统/历史后指令、作者备注；提示“只对新生成生效”|CharacterRoleplayProfile|
|/my-characters → 卡导出|creator/my-characters-page.tsx|JSON/PNG选择、兼容警告、下载失败提示|card-export|
|/chat-history → 导入聊天|chat/chat-history-page.tsx、import-preview-panel.tsx|绑定本人可用角色、时间解析、版本统计、不支持消息列表、确认新会话|CHAT ImportJob|
|/chat → 聊天 → 导出|chat/conversation-tools.tsx|保留JSON/TXT，新增ST JSONL；格式说明|原export增加format|
|消息菜单 → 分支|chat/chat-advanced-message-tools.tsx|显示分叉点、版本数与手工记忆复制语义；成功跳新会话|branches|
|消息菜单 → 版本|原版本面板|第一阶段保留现有切换语义并告知后续消息影响；分支候选均可读|versions|

组件路径均相对apps/web/src/components。列表empty/loading/error/disabled分开，不把失败当空列表；保存成功必须回读版本；请求超时支持重试且保留表单。导入未知结果先GET任务，不重复创建。文件确认页展示原始/目标字段，unsupported默认阻止确认；“降级副本”需用户明确选中并显示损失。

移动端：主入口仍在右侧半宽分类抽屉，详细编辑使用同侧全宽或足够宽度面板；一次只显示一个交互层，关闭返回原焦点。长表分组折叠且保持草稿；键盘弹出不遮住保存；触控目标至少44px；拖动排序同时有上移/下移按钮。不得把开发术语、数据库字段或许可证审查表塞进用户日常聊天。

## 管理端

|URL|归属|新增控件/动作|权限|
|---|---|---|---|
|/admin/chat/settings|既有settings-center/workspaces/sections|兼容能力开关、上传限制、书/规则/预设上限；单位与作用域说明|settings.read/write|
|/admin/chat/prompt-templates（新增）|admin/components/chat/prompt-template-management.tsx；新增对应page.tsx|平台预设列表、草稿、新修订、发布/撤回、已引用提示|settings.read/write|
|/admin/chat/memory|原记忆设置|解释token计数与来源；保留原摘要/事实开关|settings.read/write|
|/admin/ai/models|原模型管理|上下文窗口、tokenizer、参数支持范围、role策略；保存验证|ai.models.read/manage|
|/admin/characters|原角色管理|roleplay资料审查与导入来源；原发布审核保留|characters.read/write/publish|
|/admin/settings → 修改历史|原修订页面|记录新配置reason、版本、前后值和实际消费者|settings.read/write|

不增加可浏览任意用户私有提示词/聊天原文的后台入口。确需诊断时先沿原授权与审计，默认只有脱敏来源元数据。运营模型密钥仍只在现有供应商管理，不放入预设导入/导出。

## 拟新增配置键

统一登记backend/modules/settings/registry.ts并通过原设置服务读取；前端只读公开投影。限制默认值是待实现的技术保护值，正式取值需基于样本验证，不涉及价格。

|键|类型/拟默认|单位与消费点|公开投影|
|---|---|---|---|
|chat.promptPresets.enabled|boolean/false|预设选择与编译|可用性/原因|
|chat.worldbooks.advancedEnabled|boolean/false|第一阶段高级匹配|可用性|
|chat.regex.enabled|boolean/false|规则执行总开关|可用性|
|chat.imports.enabled|boolean/false|导入预览与确认|可用性|
|chat.imports.maxBytes|integer/10485760|10 MiB，上传前后双检查|上限|
|chat.imports.maxMessages|integer/10000|单JSONL消息数，不截断|上限|
|chat.imports.previewTtlSeconds|integer/86400|任务24小时过期|expiresAt|
|chat.worldbooks.maxEntries|integer/1000|单书条目数|上限|
|chat.worldbooks.maxScanDepth|integer/200|单次扫描有效消息条数|上限|
|chat.regex.maxRules|integer/100|单次组合生效规则数量|上限|
|chat.regex.maxInputChars|integer/200000|一次规则链输入上限|上限|
|chat.regex.maxOutputChars|integer/400000|替换膨胀上限|上限|
|chat.promptPresets.maxBlocks|integer/100|单预设块数|上限|

现有memory.contextBudgetTokens改为实际token语义须先M1与迁移验证；不能把旧字符预算当精确token直接扩大上下文。chat.worldbooks.contextMaxChars在兼容期保留字符硬限，新总token预算再约束，后台标明两个单位。公开投影白名单位于settings/public-keys.ts及专用能力接口；指令正文、供应商成本、密钥不得下发。

开关关闭后：历史可读、导出允许、禁新增执行；同requestId已完成结果仍可重放，不因管理员关开关制造重复收费。试运行不消耗AI预算；真实生成费用沿现有报价与结算。
