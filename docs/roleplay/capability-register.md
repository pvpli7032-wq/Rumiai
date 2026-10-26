# 能力总登记

这是需求登记，不是完成率报告。基线为 Rumiai `7b14ab88d500837962132711f189570f40c3bd73` 与 SillyTavern `06bde939fb1e9c4c8d8641d810f0a916b5bce127`（1.19.0）。状态“已有”只表示静态源码有实现，不能代替本轮运行验收；“部分”不算兼容完成。“缺口”表示该基线未找到对应闭环。全量范围是本次核对的核心、14个内置扩展、官方目录66项、补充中文生态3项，不声称覆盖互联网上所有第三方插件。

阶段：0规划清理；1A现有一致性；1B普通角色卡兼容基础；2高级上下文与玩法；3媒体体验；4脚本扩展；5平台回归和发布运营。标注文本内的阶段优先于该行默认队列。已有能力进入回归队列，不重复重做。后续每项完成必须补提交和测试证据，禁止把导入保留字段写成已执行兼容。

## 角色与角色卡

主要归属/基线证据：[packages/backend/src/modules/characters](https://github.com/pvpli7032-wq/Rumiai/tree/7b14ab88d500837962132711f189570f40c3bd73/packages/backend/src/modules/characters)。

|ID|能力|基线|目标/验收边界|队列|
|---|---|---|---|---|
|CHAR-001|基础角色资料|已有|姓名、简介、性格、背景、开场白|回归|
|CHAR-002|角色头像与图库|已有|原有上传及授权读取|回归|
|CHAR-003|角色创建审核与公开|已有|保留原审核与版权声明|回归|
|CHAR-004|多开场白|缺口|alternate_greetings选择、随机、重开时保存选中项|1B|
|CHAR-005|对话示例|缺口|mes_example分块并计入预算|1B|
|CHAR-006|角色系统提示词|缺口|system_prompt有独立块与覆盖规则|1B|
|CHAR-007|历史后指令|缺口|post_history_instructions位于尾部且可追踪|1B|
|CHAR-008|作者备注与版本|缺口|creator_notes、creator、character_version|1B|
|CHAR-009|场景字段映射|部分|scenario和background区分迁移|1B|
|CHAR-010|角色标签映射|部分|数组与现有字符串标签转换去重|1B|
|CHAR-011|V2 JSON导入导出|缺口|spec/spec_version验证与无损保留|1B|
|CHAR-012|V2 PNG导入导出|缺口|chara文本块、图片完整性及双向回读|1B|
|CHAR-013|内嵌世界书|缺口|character_book转独立书并绑定，原始结构保留|1B|
|CHAR-014|未知扩展保留|缺口|extensions保留不执行，导出回填|1B|
|CHAR-015|导入预览与冲突|缺口|新建/本人替换、警告、事务与重复确认|1B|
|CHAR-016|V3 JSON|缺口|版本识别先保留；完整语义第二阶段|1B|
|CHAR-017|CharX资源包|缺口|资源清单、相对路径、打包导出第二阶段|1B|
|CHAR-018|收藏置顶标签管理|部分|保留已有发现功能，批量编辑复核|1B|
|CHAR-019|角色复制与批量管理|部分|建立副本、批量标签、导入重复判断|1B|
|CHAR-020|角色资源包|部分|图库已有；精灵、语音等资源绑定第三阶段|1B|
|CHAR-021|支持角色资料|已有|现有SupportCharacter不等于群聊发言|回归|
|CHAR-022|角色脚本扩展|缺口|脚本隔离与许可第四阶段|1B|
|CHAR-023|角色锁定与导出规则|部分|权限已有；生态锁协议不承诺兼容|1B|
|CHAR-024|角色云草稿预览试聊|已有|沿用现有草稿、试聊副本和计费|回归|

## 用户扮演身份

主要归属/基线证据：[packages/backend/src/modules/personas/service.ts](https://github.com/pvpli7032-wq/Rumiai/tree/7b14ab88d500837962132711f189570f40c3bd73/packages/backend/src/modules/personas/service.ts)。

|ID|能力|基线|目标/验收边界|队列|
|---|---|---|---|---|
|PERSONA-001|身份新增编辑删除|已有|name/description/version|回归|
|PERSONA-002|会话绑定与私人覆盖|已有|本人会话隔离|回归|
|PERSONA-003|身份头像|缺口|独立资产及历史引用|2|
|PERSONA-004|默认身份|缺口|用户默认与显式会话绑定优先级|2|
|PERSONA-005|按角色自动绑定|缺口|映射唯一性、删除回退|2|
|PERSONA-006|身份位置深度角色|缺口|注入位置与token预算|2|
|PERSONA-007|身份导入导出|缺口|批量、冲突和来源|2|
|PERSONA-008|身份快速切换|部分|当前编辑器有绑定；快捷切换与确认|2|
|PERSONA-009|身份锁定|缺口|切换角色时保持|2|
|PERSONA-010|身份版本来源|部分|已有version；回合快照和诊断|2|

## 聊天与消息

主要归属/基线证据：[packages/backend/src/modules/conversations](https://github.com/pvpli7032-wq/Rumiai/tree/7b14ab88d500837962132711f189570f40c3bd73/packages/backend/src/modules/conversations)。

|ID|能力|基线|目标/验收边界|队列|
|---|---|---|---|---|
|CHAT-001|普通发送流式与取消|已有|保留现有回合幂等与结算|回归|
|CHAT-002|重新生成|已有|候选版本及既有计费|回归|
|CHAT-003|回复版本切换|部分|当前删除后续消息；改为预览影响和可选分支第二阶段|1A|
|CHAT-004|续写与定向改写|已有|现有任务开关、预算和版本|回归|
|CHAT-005|创建分支|部分|消息附件有复制；版本和手工记忆策略待补|1A|
|CHAT-006|消息上下文排除|部分|生成已有；建议读取未过滤|1A|
|CHAT-007|接话建议上下文一致|缺口|同一角色身份世界书历史快照|1A|
|CHAT-008|分支复制版本|缺口|新messageId和versionId重映射，计费不复制|1A|
|CHAT-009|分支手工记忆|缺口|明确复制当前手工事实或时间点语义|1A|
|CHAT-010|选版本记忆失效|已有|沿用失效工作流并补一致性回归|回归|
|CHAT-011|手工编辑AI消息|缺口|保留原文/版本、失效与审计第二阶段|1A|
|CHAT-012|插入消息|缺口|role、排序、来源和失效第二阶段|1A|
|CHAT-013|消息重排|缺口|稳定顺序与关联迁移第二阶段|1A|
|CHAT-014|消息删除|已有|保留权限和失效规则|回归|
|CHAT-015|复制与点赞|已有|保留当前菜单|回归|
|CHAT-016|全文搜索与定位|已有|稳定分页及消息窗口|回归|
|CHAT-017|会话重命名置顶归档|已有|保留列表行为|回归|
|CHAT-018|普通聊天导出|部分|现有导出不等于ST JSONL|1A|
|CHAT-019|ST JSONL导入导出|缺口|消息、swipes、时间、元数据保留1B|1A|
|CHAT-020|取消后部分文本保留|部分|需区分显示草稿与结算正文第二阶段|1A|
|CHAT-021|自动续写|缺口|有界次数、预算和用户选择第二阶段|1A|
|CHAT-022|自动swipe|缺口|过滤条件、重试上限与成本第二阶段|1A|
|CHAT-023|多用户/多角色发言标识|缺口|speakerId和role分离第二阶段|1A|
|CHAT-024|消息备注与隐藏|部分|contextIncluded与UI隐藏分离|1A|
|CHAT-025|分支时间线|缺口|父子树、定位和删除策略第二阶段|1A|
|CHAT-026|聊天背景|缺口|会话资产作用域第三阶段|1A|
|CHAT-027|消息折叠|缺口|仅显示，保留上下文第三阶段|1A|
|CHAT-028|输入中提示|部分|真实请求状态，不伪称角色在线|1A|
|CHAT-029|文本选择与长按|部分|触屏/键盘专项回归|1A|
|CHAT-030|阅读位置锚定|部分|历史分页不抢滚动|1A|
|CHAT-031|分享与举报评理|已有|平台能力保留，不移植ST覆盖|回归|
|CHAT-032|场景与章节故事|已有|独立故事状态机保留|回归|

## 提示词与生成编排

主要归属/基线证据：[packages/backend/src/modules/conversations/chat-stream.ts](https://github.com/pvpli7032-wq/Rumiai/tree/7b14ab88d500837962132711f189570f40c3bd73/packages/backend/src/modules/conversations/chat-stream.ts)。

|ID|能力|基线|目标/验收边界|队列|
|---|---|---|---|---|
|PROMPT-001|角色基础上下文|已有|现有基础角色拼装|回归|
|PROMPT-002|结构化提示词块|缺口|块ID、role、enabled、position、order|1B|
|PROMPT-003|提示词块拖动排序|缺口|服务端验证唯一顺序|1B|
|PROMPT-004|提示词预设CRUD|缺口|本人预设与平台模板分开|1B|
|PROMPT-005|预设会话绑定|缺口|版本锁定、变更显式应用|1B|
|PROMPT-006|ST Chat Completion预设导入|缺口|支持字段白名单与差异报告|1B|
|PROMPT-007|系统指令开关|缺口|用户可编辑块与平台不可编辑策略分离|1B|
|PROMPT-008|历史前后插入|缺口|beforeHistory/afterHistory可预览|1B|
|PROMPT-009|指定消息深度插入|缺口|第二阶段含depth边界|1B|
|PROMPT-010|作者注释|缺口|频率/深度/角色第二阶段|1B|
|PROMPT-011|上下文预算|部分|当前JS.length不是真token|1B|
|PROMPT-012|精确tokenizer选择|缺口|模型映射；未知必须标estimated|1B|
|PROMPT-013|回复token预留|部分|与上下文窗口统一算账|1B|
|PROMPT-014|裁剪策略|缺口|保留必要块与最近完整轮次、来源原因|1B|
|PROMPT-015|实际请求诊断|部分|已有来源；补块版本token及顺序|1B|
|PROMPT-016|纯变量char/user|缺口|不执行JS的确定替换|1B|
|PROMPT-017|角色资料宏|缺口|description/personality/scenario/mesExamples|1B|
|PROMPT-018|日期时间宏|缺口|固定回合时钟与时区第二阶段|1B|
|PROMPT-019|随机与选择宏|缺口|固定种子可回放第二阶段|1B|
|PROMPT-020|变量嵌套/作用域宏|缺口|第二阶段定义上限|1B|
|PROMPT-021|模板控制流EJS|缺口|第四阶段独立引擎与许可|1B|
|PROMPT-022|Instruct格式|缺口|Text Completion协议第二阶段|1B|
|PROMPT-023|Context模板|缺口|模板导入、分隔符第二阶段|1B|
|PROMPT-024|前缀prefill|缺口|模型能力约束第二阶段|1B|
|PROMPT-025|停止词|缺口|白名单、长度、上游真实生效|1B|
|PROMPT-026|禁止词/词偏置|缺口|模型能力约束第二阶段|1B|
|PROMPT-027|提示词快照回放|缺口|同输入可重建，不存密钥|1B|

## 世界书

主要归属/基线证据：[packages/backend/src/modules/worldbooks/service.ts](https://github.com/pvpli7032-wq/Rumiai/tree/7b14ab88d500837962132711f189570f40c3bd73/packages/backend/src/modules/worldbooks/service.ts)。

|ID|能力|基线|目标/验收边界|队列|
|---|---|---|---|---|
|WI-001|书与条目CRUD|已有|现有版本与本人权限|回归|
|WI-002|角色及会话绑定|已有|去重和可见性|回归|
|WI-003|主关键词命中|已有|当前不区分大小写includes|回归|
|WI-004|优先级排序|已有|当前priority降序|回归|
|WI-005|常驻条目|缺口|constant不依赖关键词|1B|
|WI-006|次级关键词|缺口|独立数组|1B|
|WI-007|次级逻辑|缺口|AND_ANY/AND_ALL/NOT_ANY/NOT_ALL|1B|
|WI-008|关键词正则|缺口|受限正则和错误定位|1B|
|WI-009|大小写开关|缺口|每条规则显式|1B|
|WI-010|整词匹配|缺口|Unicode边界定义，中英文测试|1B|
|WI-011|扫描深度|缺口|最近N条有效消息，0语义明确|1B|
|WI-012|扫描角色资料|缺口|第二阶段按字段白名单|1B|
|WI-013|扫描身份/摘要|缺口|第二阶段作用域明确|1B|
|WI-014|概率触发|缺口|固定回合种子第二阶段|1B|
|WI-015|递归激活|缺口|第二阶段轮数上限和循环保护|1B|
|WI-016|排除递归|缺口|第二阶段|1B|
|WI-017|阻止后续递归|缺口|第二阶段|1B|
|WI-018|递归延迟层级|缺口|第二阶段|1B|
|WI-019|互斥组|缺口|第二阶段|1B|
|WI-020|组权重|缺口|第二阶段与概率顺序固定|1B|
|WI-021|组评分|缺口|第二阶段词命中分值|1B|
|WI-022|sticky持续|缺口|第二阶段回合状态与分支复制|1B|
|WI-023|cooldown冷却|缺口|第二阶段|1B|
|WI-024|delay延迟|缺口|第二阶段|1B|
|WI-025|历史前后位置|缺口|第一阶段支持两处|1B|
|WI-026|消息深度位置|缺口|第二阶段|1B|
|WI-027|注入role|缺口|system/user/assistant模型支持约束|1B|
|WI-028|outlet插槽|缺口|第二阶段|1B|
|WI-029|不同生成事件触发|缺口|第二阶段normal/continue/swipe等|1B|
|WI-030|忽略预算|缺口|第二阶段也不得突破模型硬上限|1B|
|WI-031|每书token预算|部分|现有字符预算需迁移|1B|
|WI-032|条目命中解释|部分|已有source；补未命中/裁剪原因|1B|
|WI-033|世界书JSON导入导出|缺口|ST原uid与未知字段保留|1B|
|WI-034|条目批量操作|缺口|选择、启停、移动第二阶段|1B|
|WI-035|世界书排序|缺口|跨书顺序与优先级第二阶段|1B|
|WI-036|世界书语义检索|缺口|向量召回第二阶段|1B|
|WI-037|世界书函数调用|缺口|工具审批/结果写入第四阶段|1B|
|WI-038|世界书自动化动作|缺口|事件系统第四阶段|1B|
|WI-039|世界书收藏锁与批量搬运|缺口|第二阶段，不替代访问权限|1B|

## 记忆与资料检索

主要归属/基线证据：[packages/backend/src/modules/memory](https://github.com/pvpli7032-wq/Rumiai/tree/7b14ab88d500837962132711f189570f40c3bd73/packages/backend/src/modules/memory)。

|ID|能力|基线|目标/验收边界|队列|
|---|---|---|---|---|
|MEM-001|摘要自动生成与编辑|已有|已配置模型/预算才运行|回归|
|MEM-002|摘要版本和来源|已有|CAS与原消息验证|回归|
|MEM-003|事实新增删除固定|已有|ACTIVE及待确认历史状态|回归|
|MEM-004|源消息变更失效|已有|沿用统一失效服务|回归|
|MEM-005|身份背景修改失效|已有|回复风格不误删摘要|回归|
|MEM-006|记忆token统计|部分|字符估计须明确标记|2|
|MEM-007|分支记忆策略|部分|第一阶段修复|2|
|MEM-008|逐消息摘要|缺口|版本变更重算|2|
|MEM-009|文档知识库|缺口|上传解析分块、归属删除|2|
|MEM-010|向量模型配置|缺口|维度/版本/重建|2|
|MEM-011|向量存储|缺口|空间隔离、索引生命周期|2|
|MEM-012|语义召回|缺口|阈值topK与空召回|2|
|MEM-013|混合检索重排|缺口|关键词+向量与成本|2|
|MEM-014|引用来源定位|部分|事实有来源，文档页段缺失|2|
|MEM-015|记忆写入世界书|缺口|审批/撤销与重复去重|2|
|MEM-016|长期记忆时间线|缺口|有效时间和事实冲突|2|
|MEM-017|摘要模板与保留策略|部分|已有后台指令，用户预设待补|2|
|MEM-018|记忆导入导出|缺口|版本、来源缺失标记|2|

## 模型与供应商

主要归属/基线证据：[packages/backend/src/modules/ai](https://github.com/pvpli7032-wq/Rumiai/tree/7b14ab88d500837962132711f189570f40c3bd73/packages/backend/src/modules/ai)。

|ID|能力|基线|目标/验收边界|队列|
|---|---|---|---|---|
|AI-001|供应商模型目录|已有|原后台与生命周期|回归|
|AI-002|任务模型路由回退|已有|保留各任务预算|回归|
|AI-003|报价结算与账本|已有|保留原商业规则|回归|
|AI-004|OpenAI兼容流式文本|已有|当前主要协议|回归|
|AI-005|temperature/top_p|缺口|第一阶段能力白名单|2|
|AI-006|presence/frequency penalty|缺口|第一阶段|2|
|AI-007|max_tokens与stop|部分|第一阶段统一参数验证|2|
|AI-008|min_p/top_k/top_a|缺口|原生后端能力|2|
|AI-009|repetition penalty|缺口|上下文范围、斜率|2|
|AI-010|typical/TFS/Mirostat|缺口|采样器家族|2|
|AI-011|采样器顺序|缺口|后端枚举约束|2|
|AI-012|seed|缺口|支持声明及回放边界|2|
|AI-013|JSON结构输出|缺口|协议能力与校验|2|
|AI-014|工具调用|缺口|第四阶段工具schema/循环上限|2|
|AI-015|推理内容|缺口|独立存储展示与预算|2|
|AI-016|Anthropic原生|缺口|system合并与tool协议|2|
|AI-017|Gemini原生|缺口|parts与安全参数|2|
|AI-018|本地Text Completion|缺口|Kobold/llama.cpp等适配|2|
|AI-019|NovelAI专用协议|缺口|适配与账户许可|2|
|AI-020|OpenRouter专有参数|部分|兼容接口可用不等于完整适配|2|
|AI-021|连接预设切换|缺口|用户预设不包含运营密钥|2|
|AI-022|模型上下文能力表|部分|补tokenizer/params/role支持|2|
|AI-023|流式错误与取消计量|部分|失败/重放回归|2|
|AI-024|工具结果role映射|缺口|当前非USER统一assistant不能直接扩展|2|
|AI-025|多模态直接聊天|部分|媒体任务已有，聊天历史parts待补第三阶段|2|
|AI-026|客户端本地WebLLM|缺口|第三阶段设备能力与隐私|2|

## 群聊与故事玩法

主要归属/基线证据：[packages/backend/src/modules/stories](https://github.com/pvpli7032-wq/Rumiai/tree/7b14ab88d500837962132711f189570f40c3bd73/packages/backend/src/modules/stories)。

|ID|能力|基线|目标/验收边界|队列|
|---|---|---|---|---|
|GROUP-001|章节状态与存档|已有|保留原故事状态机|回归|
|GROUP-002|故事行动建议|已有|保留独立状态与幂等|回归|
|GROUP-003|故事恢复分支|已有|消息回合事件重映射|回归|
|GROUP-004|多角色群组CRUD|缺口|成员与顺序|2|
|GROUP-005|轮流发言|缺口|自然/列表/手选|2|
|GROUP-006|角色点名|缺口|强制下一角色|2|
|GROUP-007|群组静音停用|缺口|不删除历史|2|
|GROUP-008|群组开场白|缺口|角色与用户分开|2|
|GROUP-009|群组以角色发送|缺口|speaker权限|2|
|GROUP-010|共享/独立记忆|缺口|隔离与检索范围|2|
|GROUP-011|群组自动模式|缺口|次数、成本和停止|2|
|GROUP-012|说话者头像姓名|缺口|历史快照|2|
|GROUP-013|群组导入导出|缺口|角色缺失映射|2|
|GROUP-014|任务目标/骰子/棋盘|缺口|第四阶段玩法插件|2|

## 多媒体与界面

主要归属/基线证据：[apps/web/src/components/chat](https://github.com/pvpli7032-wq/Rumiai/tree/7b14ab88d500837962132711f189570f40c3bd73/apps/web/src/components/chat)。

|ID|能力|基线|目标/验收边界|队列|
|---|---|---|---|---|
|MEDIA-001|图片附件|已有|原上传资产权限|回归|
|MEDIA-002|图片理解任务|已有|先回填输入框|回归|
|MEDIA-003|语音录制与转写|已有|时长及WAV检查|回归|
|MEDIA-004|语音消息播放|已有|本人授权资源|回归|
|MEDIA-005|浏览器朗读|已有|速度、暂停继续|回归|
|MEDIA-006|第三方TTS提供商|缺口|队列/缓存/额度|3|
|MEDIA-007|角色声音映射|缺口|按角色/说话者|3|
|MEDIA-008|语音识别持续输入|部分|原录音转写；持续模式待补|3|
|MEDIA-009|语音转换RVC|缺口|外部服务版本与资源|3|
|MEDIA-010|图片生成|缺口|SD/ComfyUI/远端协议|3|
|MEDIA-011|图片生成工作流|缺口|模板和参数验证|3|
|MEDIA-012|图片提示词生成|缺口|手动确认与费用|3|
|MEDIA-013|情绪立绘|缺口|分类器与资源回退|3|
|MEDIA-014|Live2D|缺口|模型版权/渲染生命周期|3|
|MEDIA-015|VRM|缺口|动作口型设备负载|3|
|MEDIA-016|视觉小说模式|缺口|背景/立绘/焦点|3|
|MEDIA-017|音乐音效|缺口|播放权限与来源|3|
|MEDIA-018|Spotify联动|缺口|外部账户授权|3|
|MEDIA-019|消息翻译|缺口|原文保留与缓存版本|3|
|MEDIA-020|自动翻译|缺口|输入/输出分别可控|3|
|MEDIA-021|主题导入导出|缺口|样式范围与版本|3|
|MEDIA-022|布局预设|缺口|桌面/移动一致|3|
|MEDIA-023|自定义CSS|缺口|作用域与恢复|3|
|MEDIA-024|完整Markdown代码展示|部分|现有roleplay文本需核对支持集|3|
|MEDIA-025|LaTeX|缺口|公式渲染|3|
|MEDIA-026|Mermaid|缺口|图表渲染|3|
|MEDIA-027|图片元数据查看|缺口|只读与隐私|3|
|MEDIA-028|屏幕分享|缺口|会话授权与释放|3|
|MEDIA-029|表情选择器|已有|后台目录与历史快照|回归|
|MEDIA-030|阅读偏好|已有|字号行距气泡输入方式|回归|

## 正则、自动化与扩展基础

主要归属/基线证据：[packages/backend/src/modules/growth/modules/registry.ts](https://github.com/pvpli7032-wq/Rumiai/tree/7b14ab88d500837962132711f189570f40c3bd73/packages/backend/src/modules/growth/modules/registry.ts)。

|ID|能力|基线|目标/验收边界|队列|
|---|---|---|---|---|
|EXT-001|正则规则CRUD|缺口|第一阶段单独regex域|4|
|EXT-002|正则匹配与替换|缺口|第一阶段$1/named groups受限支持|4|
|EXT-003|正则输入阶段|缺口|第一阶段userInput|4|
|EXT-004|正则输出阶段|缺口|第一阶段modelOutput|4|
|EXT-005|正则仅显示|缺口|第一阶段display不改正文|4|
|EXT-006|正则仅提示词|缺口|第一阶段prompt不改存储|4|
|EXT-007|正则作用域|缺口|第一阶段user/character/conversation|4|
|EXT-008|正则深度范围|缺口|第二阶段|4|
|EXT-009|正则导入导出|缺口|第一阶段预览警告|4|
|EXT-010|正则试运行与差异|缺口|第一阶段不调用AI|4|
|EXT-011|快捷语|已有|当前纯文本插入与排序|回归|
|EXT-012|Quick Reply自动触发|缺口|发送/收到/打开会话事件|4|
|EXT-013|STscript命令解析|缺口|语法与类型错误|4|
|EXT-014|管道与闭包|缺口|执行预算和取消|4|
|EXT-015|局部全局变量|缺口|作用域与持久化|4|
|EXT-016|if/while/foreach|缺口|次数上限|4|
|EXT-017|脚本事件订阅|缺口|顺序重入与错误隔离|4|
|EXT-018|扩展SDK|缺口|manifest、版本、能力授权|4|
|EXT-019|扩展安装更新卸载|缺口|来源、依赖和数据处理|4|
|EXT-020|扩展设置界面|缺口|命名空间与Schema|4|
|EXT-021|扩展资产管理|缺口|路径、生命周期与缓存|4|
|EXT-022|服务端插件|缺口|隔离权限不直接任意代码加载|4|
|EXT-023|沙盒HTML/JS卡|缺口|独立origin与消息桥|4|
|EXT-024|浏览器代码执行|缺口|用户明确启动和取消|4|
|EXT-025|外部搜索工具|缺口|引用/缓存/配置|4|
|EXT-026|定时主动问候|已有|原worker订阅和通知|回归|
|EXT-027|设备推送|缺口|原站内通知不等于Web Push|4|
|EXT-028|游戏模拟器/棋盘|缺口|资源与协议许可|4|
|EXT-029|现有增长模块注册|已有|静态业务模块不是ST扩展SDK|回归|

## 内置扩展逐项登记

这14项是SillyTavern源码内置扩展；Rumiai不直接运行其前端脚本。基线证据：[内置扩展目录](https://github.com/SillyTavern/SillyTavern/tree/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/extensions)。

|ID|内置目录|Rumiai差距/目标|阶段|
|---|---|---|---|
|B-001|assets|现有上传不含扩展资源目录、下载安装与清单|4|
|B-002|attachments|现有媒体附件不含Data Bank文档解析和检索|2|
|B-003|caption|已有图片理解；消息级caption/自动策略需适配|3|
|B-004|connection-manager|后台供应商已有；连接配置组合与快捷切换待补|2|
|B-005|expressions|情绪分类、立绘映射、资源回退缺口|3|
|B-006|gallery|已有角色图库；聊天生成图合集和来源待补|3|
|B-007|memory|已有摘要事实；ST总结预设/频率兼容待补|2|
|B-008|quick-reply|已有快捷语；自动触发与脚本缺口|4|
|B-009|regex|规则、作用域、阶段、预览、导入导出缺口|1B|
|B-010|stable-diffusion|图像生成适配、提示与任务费用缺口|3|
|B-011|token-counter|真实token与来源预算缺口|1B|
|B-012|translate|消息翻译和提供商缺口|3|
|B-013|tts|浏览器朗读已有；提供商和声音映射缺口|3|
|B-014|vectors|向量化、检索和索引生命周期缺口|2|

## 官方资源目录的66个第三方扩展

目录基线：[SillyTavern Content](https://github.com/SillyTavern/SillyTavern-Content/tree/72acaca394237790106fa7b33e57ee50ea197127)。每项登记等价能力，均未安装或验证在Rumiai运行；不承诺插件二进制/JS直接兼容。每个扩展实施前固定自身提交、LICENSE和依赖版本。下列上游链接用于回溯具体项目。

|ID|扩展及来源|关联核心项|待补能力与验收点|阶段|
|---|---|---|---|---|
|E-001|[Prome Visual Novel Extension](https://github.com/Bronya-Rand/Prome-VN-Extension)|MEDIA-016|视觉小说立绘、背景染色、焦点；切换会话不串资源|3|
|E-002|[Guinevere UI Extension](https://github.com/Bronya-Rand/Guinevere-UI-Extension)|MEDIA-022|独立UI布局，保留Rumiai移动端和无障碍入口|3|
|E-003|[ProbablyTooManyTabs](https://github.com/IceFog72/SillyTavern-ProbablyTooManyTabs)|MEDIA-022|标签页布局；上游staging要求需单独适配|3|
|E-004|[Group Greetings](https://github.com/SillyTavern/Extension-GroupGreetings)|GROUP-008|群组多开场白和角色来源|2|
|E-005|[Duplicate Finder](https://github.com/SillyTavern/Extension-DupeFinder)|CHAR-019|重复角色检测预览，确认才合并|2|
|E-006|[Group SendAs](https://github.com/SillyTavern/SillyTavern-GroupSendAs)|GROUP-009|群组代角色发言权限和speaker映射|2|
|E-007|[Dynamic Audio](https://github.com/SillyTavern/Extension-Audio)|MEDIA-017|场景音乐/音效，停止与音量|3|
|E-008|[Blip](https://github.com/SillyTavern/Extension-Blip)|MEDIA-006|逐字音效，不替代完整TTS|3|
|E-009|[Idle](https://github.com/SillyTavern/Extension-Idle)|EXT-026|空闲触发动作；沿用任务额度与停止|4|
|E-010|[Speech Recognition](https://github.com/SillyTavern/Extension-Speech-Recognition)|MEDIA-008|识别提供商、语言、连续录入与取消|3|
|E-011|[Timelines](https://github.com/SillyTavern/SillyTavern-Timelines)|CHAT-025|会话分支可视化与历史定位|2|
|E-012|[RVC](https://github.com/SillyTavern/Extension-RVC)|MEDIA-009|声音转换服务适配；核对rvc-python，不依赖废弃Extras假设|3|
|E-013|[Live2d](https://github.com/SillyTavern/Extension-Live2d)|MEDIA-014|模型加载、表情与卸载|3|
|E-014|[Objective](https://github.com/SillyTavern/Extension-Objective)|GROUP-014|目标追踪与完成条件|4|
|E-015|[D&D Dice](https://github.com/SillyTavern/Extension-Dice)|GROUP-014|骰子表达式、随机源与结果留痕|4|
|E-016|[HypeBot](https://github.com/SillyTavern/Extension-HypeBot)|EXT-017|辅助建议事件及预算|4|
|E-017|[Parameter Randomizer](https://github.com/SillyTavern/Extension-Randomizer)|AI-012|采样参数随机范围和回合快照|2|
|E-018|[Web Search](https://github.com/SillyTavern/Extension-WebSearch)|EXT-025|搜索服务、来源引用与失败回退|4|
|E-019|[EmulatorJS](https://github.com/SillyTavern/SillyTavern-EmulatorJS)|EXT-028|模拟器资源来源与暂停|4|
|E-020|[Variable Viewer](https://github.com/LenAnderson/SillyTavern-Variable-Viewer)|EXT-015|变量查看编辑、作用域和刷新|4|
|E-021|[VRM](https://github.com/SillyTavern/Extension-VRM)|MEDIA-015|3D模型、口型与帧率降级|3|
|E-022|[Quick Persona](https://github.com/SillyTavern/Extension-QuickPersona)|PERSONA-008|当前身份快捷切换|2|
|E-023|[Silence Player](https://github.com/SillyTavern/Extension-Silence)|MEDIA-017|静音音频保活用途与可关闭性|3|
|E-024|[Code Runner](https://github.com/SillyTavern/Extension-CodeRunner)|EXT-024|隔离执行代码与结果回显|4|
|E-025|[Push Notifications](https://github.com/SillyTavern/SillyTavern-PushNotifications)|EXT-027|Web Push订阅撤销，不混同站内通知|4|
|E-026|[Chat Top Bar](https://github.com/SillyTavern/Extension-TopInfoBar)|MEDIA-022|会话信息栏与窄屏折叠|3|
|E-027|[Emoji Picker](https://github.com/SillyTavern/Extension-EmojiPicker)|MEDIA-029|系统emoji插入与当前贴纸目录区分|3|
|E-028|[Notebook](https://github.com/SillyTavern/Extension-Notebook)|MEM-018|个人笔记，不默认为角色事实|2|
|E-029|[Chess](https://github.com/SillyTavern/SillyTavern-Chess)|EXT-028|棋盘状态、合法走子、保存恢复|4|
|E-030|[Screen Share](https://github.com/SillyTavern/Extension-ScreenShare)|MEDIA-028|屏幕采集、截图及停止指示|3|
|E-031|[Prompt Inspector](https://github.com/SillyTavern/Extension-PromptInspector)|PROMPT-015|提示词来源和实际顺序，私有块脱敏|1B|
|E-032|[Image Metadata Viewer](https://github.com/SillyTavern/Extension-ImageMetadataViewer)|MEDIA-027|图片元数据读取及导出隐私|3|
|E-033|[WebLLM](https://github.com/SillyTavern/Extension-WebLLM)|AI-026|本地浏览器模型能力和下载管理|3|
|E-034|[Mermaid](https://github.com/SillyTavern/Extension-Mermaid)|MEDIA-026|图表渲染、错误提示、导出|3|
|E-035|[Weather](https://github.com/SillyTavern/Extension-Weather)|EXT-025|天气工具与地点/时间来源|4|
|E-036|[RSS](https://github.com/SillyTavern/Extension-RSS)|EXT-025|RSS抓取去重、引用及更新|4|
|E-037|[LaTeX](https://github.com/SillyTavern/Extension-LaTeX)|MEDIA-025|数学渲染与原文切换|3|
|E-038|[Inject Manager](https://github.com/SillyTavern/Extension-InjectManager)|PROMPT-009|命名注入点、深度和有效范围|2|
|E-039|[CodeMirror](https://github.com/SillyTavern/Extension-CodeMirror)|MEDIA-024|编辑器高亮，不把语法高亮当脚本执行|3|
|E-040|[Sampler Commands](https://github.com/SillyTavern/Extension-SamplerCommands)|AI-011|脚本采样命令映射至支持参数|4|
|E-041|[Message Limit](https://github.com/SillyTavern/Extension-MessageLimit)|PROMPT-014|上下文消息数限制及裁剪解释|2|
|E-042|[Lorem Ipsum](https://github.com/SillyTavern/Extension-LoremIpsum)|EXT-024|测试文本生成；生产不注入占位内容|4|
|E-043|[Typing Indicator](https://github.com/SillyTavern/Extension-TypingIndicator)|CHAT-028|请求状态呈现|3|
|E-044|[Custom Scenario](https://github.com/bmen25124/SillyTavern-Custom-Scenario)|CHAR-009|私人场景覆盖与公开角色隔离|2|
|E-045|[Script Events](https://github.com/SillyTavern/Extension-ScriptEvents)|EXT-017|事件订阅顺序、错误和注销|4|
|E-046|[Message Summarize](https://github.com/qvink/SillyTavern-MessageSummarize)|MEM-008|单消息摘要与版本失效|2|
|E-047|[Magic Translation](https://github.com/bmen25124/SillyTavern-Magic-Translation)|MEDIA-020|输入/输出翻译、缓存与失败保留原文|3|
|E-048|[Character Creator](https://github.com/bmen25124/SillyTavern-Character-Creator)|CHAR-001|辅助角色创作草稿，人工确认发布|2|
|E-049|[World Info Recommender](https://github.com/bmen25124/SillyTavern-WorldInfo-Recommender)|WI-036|世界书推荐与可解释选择|2|
|E-050|[Roadway](https://github.com/bmen25124/SillyTavern-Roadway)|CHAT-025|分支导航与路径视图|2|
|E-051|[Flowchart](https://github.com/bmen25124/SillyTavern-Flowchart)|EXT-017|可视化自动化流程与停止|4|
|E-052|[WTracker](https://github.com/bmen25124/SillyTavern-WTracker)|WI-032|世界书使用状态跟踪|2|
|E-053|[Custom Sliders](https://github.com/SillyTavern/Extension-CustomSliders)|AI-011|自定义参数滑杆范围和能力限制|2|
|E-054|[Quick Context Buttons](https://github.com/SillyTavern/Extension-QuickContextSize)|PROMPT-011|上下文预算快捷按钮，不超过模型上限|1B|
|E-055|[Spotify](https://github.com/SillyTavern/Extension-Spotify)|MEDIA-018|外部音乐授权和退出|3|
|E-056|[Guided Generations](https://github.com/Samueras/GuidedGenerations-Extension)|PROMPT-024|受控引导生成，模型能力与费用|2|
|E-057|[World Info Bulk Mover](https://github.com/leandrojofre/SillyTavern-WI-Bulk-Mover)|WI-034|条目批量移动，原uid/绑定不丢|2|
|E-058|[Pronouns](https://github.com/Wolfsblvt/SillyTavern-Pronouns)|PERSONA-010|称谓代词宏；上游已迁至SillyTavern组织需按新来源核验|2|
|E-059|[Message Collapser](https://github.com/Crystaria/SillyTavern-MessageCollapser)|CHAT-027|折叠只影响渲染|3|
|E-060|[World Info Function Call](https://github.com/Culpeo/SillyTavern-WI-FunctionCall)|WI-037|模型工具写书、审批与审计|4|
|E-061|[Memory Books](https://github.com/aikohanasaki/SillyTavern-MemoryBooks)|MEM-015|记忆生成世界书，重复和撤销|2|
|E-062|[World Info Info](https://github.com/aikohanasaki/SillyTavern-WorldInfoInfo)|WI-032|条目信息与命中诊断|2|
|E-063|[Character Locks](https://github.com/aikohanasaki/SillyTavern-CharacterLocks)|CHAR-023|角色锁与真实权限区分|2|
|E-064|[World Info Locks](https://github.com/aikohanasaki/SillyTavern-WorldInfoLocks)|WI-039|世界书锁与真实权限区分|2|
|E-065|[Lorebook Ordering](https://github.com/aikohanasaki/SillyTavern-LorebookOrdering)|WI-035|书顺序与条目优先级组合|2|
|E-066|[Model Injection](https://github.com/aikohanasaki/SillyTavern-ModelInjection)|PROMPT-008|模型相关提示注入和切换失效|2|

## 中文社区补充生态

|ID|来源|登记范围|阶段/边界|
|---|---|---|---|
|CN-001|[酒馆助手](https://github.com/N0VI028/JS-Slash-Runner/tree/0af421068e7c03b6b0a71b68feb79d201164edeb)|前端脚本、iframe、事件桥、变量、消息操作、扩展API|4；PolyForm Noncommercial，不能因本项目公开就直接复制进商业产品|
|CN-002|[MVU](https://github.com/MagicalAstrogy/MagVarUpdate/tree/d03b7dc8a6ebf9bd611c7e2dc91f3b35462deebc)|结构化变量、更新校验、状态回放、消息事件集成|4；需先完成消息版本与脚本事件；MIT仍保留声明|
|CN-003|[提示词模板EJS](https://github.com/zonde306/ST-Prompt-Template/tree/d6f520d149aba146305b0b781ddd691d449c28d2)|模板执行、变量和世界书联动|4；AGPL-3.0，先决定独立实现或合规复用|

Rumiai当前MIT不变。SillyTavern为AGPL-3.0；公开源码不自动满足所有再分发义务，也不改变第三方非商业许可。第一阶段按公开格式独立实现，不复制扩展实现；引用时逐项目登记许可。

## 旧审计需求保全登记

删除旧长文前提取以下全部223个唯一编号，共244次表格记录（同号后文可能补充）。**原状态是历史描述，不是当前缺陷结论**。旧文18—22节记录了多批修复；其中上下文、世界书、版本、媒体、通知、抽屉已存在，不能按前文“拟新增”重复开发。每项进入阶段5平台回归队列；涉及核心表能力者按核心项更早执行。没有逐项新验收证据的状态统一为“待基线复核”。完整历史表含字段、接口、验收和后续实施记录保留在[固定Git提交](https://github.com/pvpli7032-wq/Rumiai/blob/7b14ab88d500837962132711f189570f40c3bd73/docs/frontend-capability-audit-20261025.md)，不在当前目录继续维护两份矛盾计划。

|原ID|历史需求摘要（去重合并）|当前处理|
|---|---|---|
|LEGACY-F001|角色搜索、类型与身份筛选 ； 已实现代码|待基线复核；保留原验收要求|
|LEGACY-F002|推荐、世界观、创作者、榜单入口 ； 已实现代码|待基线复核；保留原验收要求|
|LEGACY-F003|兴趣引导联动推荐 ； 部分实现|待基线复核；保留原验收要求|
|LEGACY-F004|角色开场白、场景建议 ； 已实现代码|待基线复核；保留原验收要求|
|LEGACY-F005|动态接话建议、换一批、代写 ； 未发现实现|待基线复核；保留原验收要求|
|LEGACY-F006|首次聊天漏斗分析 ； 已有接口待验收 / 原有运营报表新增首聊打开→首轮→第三轮→成熟次日回访；前端只能上报访问类事件，不能伪造完成；只认无取消原因的成功落库回执 ； ProductEvent、GenerationCharge、UserActivityDay；明确UTC口径和开始追踪时间，不补造旧数据|待基线复核；保留原验收要求|
|LEGACY-F007|发送、流式回复、取消 ； 已实现代码 / 免费聊天也保存零金额回执，防同请求重复调用模型和重复落消息；免费取消不占免费取消次数 ； 原GenerationCharge状态机；FREE_MODE coins=0，不扣币、不占聊天免费次数|待基线复核；保留原验收要求|
|LEGACY-F008|普通聊天多行输入 ； 部分实现|待基线复核；保留原验收要求|
|LEGACY-F009|草稿刷新恢复与会话隔离 ； 部分实现|待基线复核；保留原验收要求|
|LEGACY-F010|快捷语管理 ； 已实现代码|待基线复核；保留原验收要求|
|LEGACY-F011|表情与贴纸 ； 已实现且隔离测试通过|待基线复核；保留原验收要求|
|LEGACY-F012|图片消息 ； 已实现且隔离测试通过|待基线复核；保留原验收要求|
|LEGACY-F013|AI识图与图片问答 ； 未实现，边界已声明|待基线复核；保留原验收要求|
|LEGACY-F014|语音输入和语音消息 ； 未发现实现|待基线复核；保留原验收要求|
|LEGACY-F015|复制、点赞、举报 ； 已实现代码|待基线复核；保留原验收要求|
|LEGACY-F016|编辑用户消息并重新生成 ； 已实现代码|待基线复核；保留原验收要求|
|LEGACY-F017|直接编辑AI回复 ； 未实现|待基线复核；保留原验收要求|
|LEGACY-F018|重新生成 ； 已实现代码|待基线复核；保留原验收要求|
|LEGACY-F019|回复版本切换、分支会话 ； 未发现完整实现|待基线复核；保留原验收要求|
|LEGACY-F020|删除某条及之后的消息 ； 后端有、前端入口不足|待基线复核；保留原验收要求|
|LEGACY-F021|浏览器朗读 ； 部分实现|待基线复核；保留原验收要求|
|LEGACY-F022|长历史分页 ； 部分实现|待基线复核；保留原验收要求|
|LEGACY-F023|会话搜索、归档、删除、导出 ； 已实现代码|待基线复核；保留原验收要求|
|LEGACY-F024|全文检索、置顶会话、自定义标题入口 ； 部分/未发现完整入口|待基线复核；保留原验收要求|
|LEGACY-F025|摘要及确认事实注入AI ； 已实现且隔离测试通过|待基线复核；保留原验收要求|
|LEGACY-F026|记忆确认、忽略、编辑、固定、删除 ； 部分实现|待基线复核；保留原验收要求|
|LEGACY-F027|记忆加载错误及重试 ； 存在缺陷|待基线复核；保留原验收要求|
|LEGACY-F028|手动添加与来源定位 ； 部分实现|待基线复核；保留原验收要求|
|LEGACY-F029|多用户身份Persona ； 未发现完整实现|待基线复核；保留原验收要求|
|LEGACY-F030|世界书/Lorebook关键词触发 ； 未发现完整实现|待基线复核；保留原验收要求|
|LEGACY-F031|关系模式影响AI ； 部分实现|待基线复核；保留原验收要求|
|LEGACY-F032|亲密度成长与关系等级 ； 部分实现|待基线复核；保留原验收要求|
|LEGACY-F033|私人备注 ； 已有保存、语义需明确|待基线复核；保留原验收要求|
|LEGACY-F034|角色详情、设定、开场、模型费用 ； 已实现代码|待基线复核；保留原验收要求|
|LEGACY-F035|点赞收藏、评论、作者关注 ； 已有接口和组件|待基线复核；保留原验收要求|
|LEGACY-F036|角色创建、编辑、草稿、发布 ； 已有代码链路|待基线复核；保留原验收要求|
|LEGACY-F037|角色任务与奖励 ； 已有代码链路|待基线复核；保留原验收要求|
|LEGACY-F038|角色相册、情绪图片、配角 ； 部分实现|待基线复核；保留原验收要求|
|LEGACY-F039|角色卡导入导出、版本回滚 ； 未发现完整实现|待基线复核；保留原验收要求|
|LEGACY-F040|故事目录、回合、结束章节、继续 ； 已实现代码|待基线复核；保留原验收要求|
|LEGACY-F041|故事状态整理和检查点 ； 已有后端实现|待基线复核；保留原验收要求|
|LEGACY-F042|分支树、存档槽、剧情编辑器 ； 未发现完整前台|待基线复核；保留原验收要求|
|LEGACY-F043|评理、投票、镜像对照 ； 已有独立模块|待基线复核；保留原验收要求|
|LEGACY-F044|主动问候、离线消息、纪念日 ； 未发现完整实现|待基线复核；保留原验收要求|
|LEGACY-F045|日记、状态、陪伴计时、一起听歌 ； 未发现完整实现|待基线复核；保留原验收要求|
|LEGACY-F046|角色声线、电话、实时语音 ； 未发现完整实现|待基线复核；保留原验收要求|
|LEGACY-F047|AI生图、视频、动态头像 ； 未发现完整实现|待基线复核；保留原验收要求|
|LEGACY-F048|圈子、帖子、评论、关注、通知 ； 已有代码链路|待基线复核；保留原验收要求|
|LEGACY-F049|普通聊天分享 ； 存在权限缺陷|待基线复核；保留原验收要求|
|LEGACY-F050|选消息分享、分享卡、撤销中心 ； 未完整实现|待基线复核；保留原验收要求|
|LEGACY-F051|举报、申诉与审核 ； 已有接口和模块|待基线复核；保留原验收要求|
|LEGACY-F052|资料修改、资产页、账号导出注销 ； 已有代码链路|待基线复核；保留原验收要求|
|LEGACY-F053|阅读模式、屏蔽词 ； 部分实现|待基线复核；保留原验收要求|
|LEGACY-F054|邮箱验证、找回密码、激活 ； 部分实现|待基线复核；保留原验收要求|
|LEGACY-F055|主题、移动导航、抽屉 ； 已实现代码|待基线复核；保留原验收要求|
|LEGACY-F056|会员套餐后台配置→前台 ； 已实现代码，线上无可售套餐|待基线复核；保留原验收要求|
|LEGACY-F057|价格、周期、权益订单快照 ； 已实现代码|待基线复核；保留原验收要求|
|LEGACY-F058|支付后生效、手动续费 ； 已实现代码|待基线复核；保留原验收要求|
|LEGACY-F059|24小时退款及使用权益计费 ； 已实现代码，待本轮业务验收|待基线复核；保留原验收要求|
|LEGACY-F060|真实权益与装饰文案区分 ； 已有受限权益模型|待基线复核；保留原验收要求|
|LEGACY-F061|金币套餐、订单、账本 ； 已有代码，收款关闭|待基线复核；保留原验收要求|
|LEGACY-F062|邀请和返佣 ； 部分实现|待基线复核；保留原验收要求|
|LEGACY-F063|独立管理登录和权限 ； 已有独立模块|待基线复核；保留原验收要求|
|LEGACY-F064|用户详情与资料/资产联动 ； 已有接口和模块|待基线复核；保留原验收要求|
|LEGACY-F065|AI供应商、模型删除 ； 已有删除路由待重验|待基线复核；保留原验收要求|
|LEGACY-F066|设置分组、版本与历史 ； 已有模块和测试|待基线复核；保留原验收要求|
|LEGACY-F067|签到、任务、礼物模块 ； 已有受控模块|待基线复核；保留原验收要求|
|LEGACY-F068|CMS、公告、导航及内容版本 ； 已有接口和组件|待基线复核；保留原验收要求|
|LEGACY-F069|任务、费用、审计与运行状态 ； 已有模块和路由|待基线复核；保留原验收要求|
|LEGACY-F070|前端/后台/API/worker分层 ； 已检查通过|待基线复核；保留原验收要求|
|LEGACY-C01|自动增高多行输入、内部滚动 ； chat.maxMessageChars；高度属设计规范 / 多行自动高度、中文输入法保护、桌面发送/换行与触屏换行；账号/会话草稿持久化；刷新后按原请求查回执再恢复 ； chat.maxMessageChars；GenerationCharge请求回执|待基线复核；保留原验收要求|
|LEGACY-C02|中文组词不误发送；换行发送规则明确 ； 无运营参数；快捷键属拟用户偏好|待基线复核；保留原验收要求|
|LEGACY-C03|会话草稿刷新返回保留，成功清除 ； 设备内账号隔离；云同步后做|待基线复核；保留原验收要求|
|LEGACY-C04|发送/输出/失败状态，防重复 ； limits.chat.perWindow/windowSeconds|待基线复核；保留原验收要求|
|LEGACY-C05|取消前显示政策、免费取消剩余 ； billing.cancelPolicy/freeCancelPerDay|待基线复核；保留原验收要求|
|LEGACY-C06|断线区分未发送/待确认，查原请求再重试 ； 复用回执幂等，不造重试运营开关|待基线复核；保留原验收要求|
|LEGACY-C07|额度余额、模型费用、重置时间；不足留草稿 ； billing.freeDailyMessages/hardDailyMessages/priceMultiplier/dayTimezone；模型币价与会员|待基线复核；保留原验收要求|
|LEGACY-C08|快捷语增删改，不覆盖原草稿 ； User.shortcuts，限制共用契约 / 快捷语排序、预览与插入；字号、行距、气泡、流式展示、发送键、朗读速度保存后实际消费 ； users/me；User.readerPreferencesJson/shortcuts；共享ReaderPreferences验证|待基线复核；保留原验收要求|
|LEGACY-C09|表情贴纸面板、反馈、重试 ； 当前CHAT_STICKERS代码目录；后台运营目录拟新增 / 表情选择器读取后台目录；新增、上架、排序、删除；历史消息保存当时的名称与表情 ； /admin/chat/stickers；/api/admin/chat/stickers；/api/chat/stickers；ChatSticker、MessageAttachment.stickerSnapshotJson、后台审计|待基线复核；保留原验收要求|
|LEGACY-C10|图片缩略预览、大小、移除；上传保存分状态 ； upload.maxMB；limits.upload.perWindow/windowSeconds|待基线复核；保留原验收要求|
|LEGACY-C11|帮我接一句、换一批、编辑插入，不代发 ； 拟接话任务开关/额度/模型/预算，不偷用聊天额度 / 真实模型生成接话建议、换一批、插入后可编辑、不代发；与聊天免费次数、金币分开；幂等结果持久化 ； chat.suggestions.*、ai.taskModel.chatSuggestions、budget.task.chatSuggestions、prompt.chatSuggestions；ChatSuggestionRequest/AiCall；billing.dayTimezone日界线|待基线复核；保留原验收要求|
|LEGACY-C12|区分保存图片与AI识图 ； 拟视觉能力模型价格，复用上传限制 / 附件工具内图片理解、麦克风录制/取消、试听、语音转写；结果先编辑再放入输入框或明确发送语音 ； conversations/:id/media及image/transcription；media.*、prompt.imageUnderstanding；专用模型、正预算、日额度；MediaTaskRequest、AiCall、UploadAsset；WAV真实时长与本人读取|待基线复核；保留原验收要求|
|LEGACY-C13|长按/更多菜单，按角色状态显示动作 ； 无额外参数，权限在服务端 / 原生选字与显式更多菜单共存；复制失败反馈；编辑/删除说明后续历史影响；日期与实际发送状态；回看不抢滚动；历史分页和附件；TXT/JSON导出附件引用 ； 消息服务拥有者校验、统一chat.maxMessageChars、源消息/附件与派生记忆故事失效|待基线复核；保留原验收要求|
|LEGACY-C14|复制反馈、失败手动选择 ； 无后台参数|待基线复核；保留原验收要求|
|LEGACY-C15|点赞取消防连击，失败回滚 ； 个人反馈非公共热度 / 消息更多菜单内版本切换、续写/按要求改写、分支；保留原消息身份与各版本；重放请求返回原版本 ； MessageVersion、GenerationCharge.messageVersionId；chat.revisions.*；专用chatRevision模型与预算；显式REGENERATE计费政策后开放|待基线复核；保留原验收要求|
|LEGACY-C16|编辑前说明删除后续历史 ； 编辑4000常量与发送chat.maxMessageChars不同，需统一或正式分规则|待基线复核；保留原验收要求|
|LEGACY-C17|重生成说明范围费用，失败留原文 ； 现有价格取消政策，不写免费承诺|待基线复核；保留原验收要求|
|LEGACY-C18|同轮候选切换、当前/总数 ； 复用生成价格，开放额度需正式登记|待基线复核；保留原验收要求|
|LEGACY-C19|删除显示此条及之后并确认 ； 拥有者权限，不造假删除开关|待基线复核；保留原验收要求|
|LEGACY-C20|消息处分支，保留原会话和来源 ； 限额收费未定不编造|待基线复核；保留原验收要求|
|LEGACY-C21|浏览器朗读停止、能力提示 ； 本地speechSynthesis无云价格|待基线复核；保留原验收要求|
|LEGACY-C22|举报原因、状态、记录与进度 ； 举报类型、limits.report.perWindow/windowSeconds|待基线复核；保留原验收要求|
|LEGACY-C23|上滑分页保位置、失败重试 ； 技术分页不等于chat.historyMessages模型历史|待基线复核；保留原验收要求|
|LEGACY-C24|回看不被流式打断，回到最新 ； 纯交互无后台参数|待基线复核；保留原验收要求|
|LEGACY-C25|只读历史分页和附件统一渲染 ； 无额外参数|待基线复核；保留原验收要求|
|LEGACY-C26|TXT/JSON范围说明、附件引用、重试 ； 导出格式契约不运营拼字段|待基线复核；保留原验收要求|
|LEGACY-C27|选条分享预览脱敏撤销 ； 拟分享范围有效期，非客户端硬编码|待基线复核；保留原验收要求|
|LEGACY-C28|阅读模式、屏蔽折叠、对白动作排版 ； User.readingMode/bannedWords，非审核禁词|待基线复核；保留原验收要求|
|LEGACY-C29|继续上次和新建分开 ； 用户操作，无全站参数|待基线复核；保留原验收要求|
|LEGACY-C30|重命名保存取消非空 ； 标题长度统一契约 / 重命名与置顶会话；正文全文搜索；点击命中加载该消息附近窗口并定位，能回到最新 ； Conversation.title/pinnedAt；本人搜索API及messages/:id/window；稳定时间+id分页|待基线复核；保留原验收要求|
|LEGACY-C31|置顶取消，与最近排序区分 ； 数量限制有需求才登记|待基线复核；保留原验收要求|
|LEGACY-C32|归档恢复可发现、不是删除 ； 无后台参数|待基线复核；保留原验收要求|
|LEGACY-C33|列表分页，名称搜索范围提示 ； 当前take:200非分页；技术边界契约 / 会话全量名称搜索与游标分页；私人备注说明；模型选项展示服务端有效费用、换模确认、失效显式模型在收费前拒绝；删除真实清理记忆与分享，保留应留账务记录 ； Conversation、MemoryFact、AiModel与quoteReplyPrice；原有费用账本|待基线复核；保留原验收要求|
|LEGACY-C34|全文片段并定位消息 ； 鉴权查询长度限流，不配关键词名单|待基线复核；保留原验收要求|
|LEGACY-C35|私人备注保存反馈、仅自己看 ； notes当前不注入AI|待基线复核；保留原验收要求|
|LEGACY-C36|关系模式说明效果范围 ； relationshipMode已有；拟后台效果规则后端消费|待基线复核；保留原验收要求|
|LEGACY-C37|等级来源、下一阶段、变动记录 ； TIERS占位；拟成长政策，数值不编造|待基线复核；保留原验收要求|
|LEGACY-C38|记忆关闭/空/加载/失败四态 ； memory.enabled，失败非关闭|待基线复核；保留原验收要求|
|LEGACY-C39|确认转已生效，忽略才移除 ； memory开关，无额外价格|待基线复核；保留原验收要求|
|LEGACY-C40|编辑固定删除及逐项错误状态 ； memory.maxFacts是注入数；200字200条常量若可调需登记|待基线复核；保留原验收要求|
|LEGACY-C41|添加、记住这句、来源定位 ； create函数有但集合路由尚无POST / 消息记忆、身份、私人角色补充、世界书绑定、回复风格与长度、排除上下文、查看实际引用来源 ； UserPersona、Worldbook/Entry/绑定表、ConversationContextUse；chat.personaMaxChars/personalOverrideMaxChars/worldbooks.*/responseStyles/responseLengths；后台指令不下发前端|待基线复核；保留原验收要求|
|LEGACY-C42|作用范围预算摘要状态，不承诺无限 ； memory.summaryTriggerMessages/summaryMaxChars/maxFacts/contextBudgetTokens；prompt.memorySummary；ai.taskModel.memorySummary；budget.task.memorySummary|待基线复核；保留原验收要求|
|LEGACY-C43|多身份、会话绑定和切换影响 ； 身份数量长度按需求登记，roleTemplate非用户身份|待基线复核；保留原验收要求|
|LEGACY-C44|世界书条目触发词命中说明 ； 拟开关预算优先级，非现有universes|待基线复核；保留原验收要求|
|LEGACY-D01|全站搜索输入清空提交、结果状态；当前只过滤已载热门/最新 ； 已有标签；查询长度分页上限归服务契约|待基线复核；保留原验收要求|
|LEGACY-D02|多选筛选、条件移除清空、说明交集语义 ； CMS Tag.key/label/filterRow/group|待基线复核；保留原验收要求|
|LEGACY-D03|搜索历史单删清空、空输入显示 ； 无需运营参数；热搜如做另属运营资源 / 搜索历史删除/清空；不感兴趣持久化及撤销（只影响推荐，搜索和关注仍可找回）；分区独立错误；图库滑动全屏/坏图；长资料展开；评论排序分页 ； me/discovery-preferences、me/hidden-characters、角色评论与回复API；UserSearchHistory/UserHiddenCharacter；实际推荐投影|待基线复核；保留原验收要求|
|LEGACY-D04|无结果与服务异常分开，清部分条件、相关标签 ； 相关标签CMS；运营文案归site-content|待基线复核；保留原验收要求|
|LEGACY-D05|推荐策略数量服务端统一；当前前端独家优先热门补齐、多个12固定 ； 拟discovery.recommendationStrategy/railLimit，支持有限枚举；优先复用CMS分区|待基线复核；保留原验收要求|
|LEGACY-D06|不感兴趣/屏蔽、撤销和列表 ； 拟功能开放；本人名单不是后台逐个手填|待基线复核；保留原验收要求|
|LEGACY-D07|故事/关注等分区独立加载错误重试，当前部分失败静默隐藏 ； mirror.enabled/dispute.enabled；story.enabled已有，需消费|待基线复核；保留原验收要求|
|LEGACY-D08|详情关闭保筛选滚动分页 ； 纯路由交互不运营配置|待基线复核；保留原验收要求|
|LEGACY-D09|兴趣选择立即更新推荐，当前只结束时保存 ； growth.onboardingEnabled/interestTags|待基线复核；保留原验收要求|
|LEGACY-D10|可编辑开场选择、普通/场景区别 ； 角色greeting/scenario；新首聊模板归角色场景内容|待基线复核；保留原验收要求|
|LEGACY-D11|图库左右圆点已有，补序号全屏滑动失败占位 ； CharacterImage.sortOrder及资产管理|待基线复核；保留原验收要求|
|LEGACY-D12|简介人设背景开场各自展开收起，保换行位置 ； content.character.nameMax/summaryMax/personaMax/backgroundMax/openingMax；展开是展示常量|待基线复核；保留原验收要求|
|LEGACY-D13|详情标签显示label并可点筛选，当前直接key ； Tag.key/label/group/filterRow / 标签key映射后台名称；移除前端独有40字限制；上传读后台上限；创作草稿按账号及编辑对象隔离；未保存退出保护 ； character校验契约、upload.maxMB、本人角色和上传归属|待基线复核；保留原验收要求|
|LEGACY-D14|作者入口关注状态、失败恢复，匿名登录后回详情 ； 作者公开资料，不配伪粉丝数|待基线复核；保留原验收要求|
|LEGACY-D15|点赞收藏锁、反馈、收藏页一致 ； 服务器状态，不前端造计数|待基线复核；保留原验收要求|
|LEGACY-D16|继续/新建已存在，补最近会话提示及含义 ； 角色模型有效性服务端裁决|待基线复核；保留原验收要求|
|LEGACY-D17|reply-plan展示免费/会员差价/模型/错误 ； 后台模型scope、金币价格、会员权益|待基线复核；保留原验收要求|
|LEGACY-D18|评论排序分页编辑删除点赞举报，失败留草稿 ； content.comment.maxChars；审核速率复用已查规则，不编key|待基线复核；保留原验收要求|
|LEGACY-D19|任务进度条件、领取时间、失败恢复 ； CharacterQuest.requiredMessages/rewardCoins|待基线复核；保留原验收要求|
|LEGACY-D20|礼物确认价格，配角维持介绍语义 ； GiftCatalog启用价格；角色配角/情绪资产 / 版本云草稿保存/恢复/删除；真实角色卡预览；私有试聊副本沿现有聊天收费与权限 ； creator云稿API、CharacterDraft.version；原角色创建额度与校验|待基线复核；保留原验收要求|
|LEGACY-D21|字段校验一致；当前人设最少40前端硬编码 ； max keys已有；如保留最少拟content.character.personaMin|待基线复核；保留原验收要求|
|LEGACY-D22|本地自动存草稿、快捷保存清空已有；账号隔离需补 ； 无后台参数|待基线复核；保留原验收要求|
|LEGACY-D23|云草稿、保存中失败冲突，不能把本地叫云存 ； 草稿生命周期和服务上限，不造通用存储平台|待基线复核；保留原验收要求|
|LEGACY-D24|头像上传进度取消重试预览，新图失败留旧图 ； upload.maxMB及上传频率、类型契约|待基线复核；保留原验收要求|
|LEGACY-D25|标签徽章搜索分组、移除、下架旧值解释 ； 现有CMS目录；数量上限先查现有再统一契约|待基线复核；保留原验收要求|
|LEGACY-D26|发布前检查，草稿待审拒绝公开清晰 ； 角色发布审核规则、版权、拒绝原因|待基线复核；保留原验收要求|
|LEGACY-D27|预览用实际展示组件；真实试聊说明成本保存范围 ； 现有模型计费，不用固定示例冒充AI成功|待基线复核；保留原验收要求|
|LEGACY-D28|我的角色编辑删除状态、影响说明 ； 后端删除条件，不用前端可删布尔绕引用 / 故事工具内存档、恢复成独立分支、实际事实来源时间线、导出；行动建议按后台数量返回 ； StorySave快照、StoryRun父来源；恢复重映射消息/回合/事件/检查点，不复制费用/会员使用；story.actionSuggestions|待基线复核；保留原验收要求|
|LEGACY-D29|故事简介角色章节、可继续、空/错分开 ； story.enabled/enabledTemplates，发布版本|待基线复核；保留原验收要求|
|LEGACY-D30|静态建议与动态区分；按本回合显示可编辑建议 ； story.actionSuggestions key存在但消费待补证；动态模型预算复用|待基线复核；保留原验收要求|
|LEGACY-D31|整理中/可结束/失败/继续用可理解状态 ； story.stateBatchSize/stateMaxAttempts|待基线复核；保留原验收要求|
|LEGACY-D32|正文事实约定章节摘要时间线 ； 类型用contracts枚举，不复制状态规则|待基线复核；保留原验收要求|
|LEGACY-D33|存档分支入口，检查点不等于可读档 ； 拟支持数量开关；售卖额度须真实消费|待基线复核；保留原验收要求|
|LEGACY-D34|故事导出范围错误重试，区别公开分享 ； 领域权限，无任意导出字段配置|待基线复核；保留原验收要求|
|LEGACY-D35|圈子访客未订阅已订阅受限状态及原因 ； 圈子/成员限制，后端执行|待基线复核；保留原验收要求|
|LEGACY-D36|发帖逐图预览移除重试、失败保留 ； content.post.maxChars/maxImages；upload.maxMB|待基线复核；保留原验收要求|
|LEGACY-D37|帖评编辑删除、冲突保草稿，影响说明 ； 统一内容长度及审核规则|待基线复核；保留原验收要求|
|LEGACY-D38|长feed评论按展开加载分页保位置，当前逐帖并发读 ； 页上限服务契约，不堆运营参数 / 社区动态分页、评论按需加载和回复分页 ； 原帖子/评论权限与真实分页接口|待基线复核；保留原验收要求|
|LEGACY-D39|举报申诉目标原因状态与结果，受限可申诉 ； 后台审核权限原因，前台不判罚|待基线复核；保留原验收要求|
|LEGACY-D40|分页、单条/全部已读、错误回滚已有，补提示重试 ； 通知类型共享契约，无新运营参数|待基线复核；保留原验收要求|
|LEGACY-D41|通知定位具体目标，已删/无权有解释落点 ； 类型决定安全目标，不由任意模板拼链接|待基线复核；保留原验收要求|
|LEGACY-D42|分类偏好免打扰，站内通知不等于推送主动聊天 ； 拟允许类别/个人偏好，运营需权限|待基线复核；保留原验收要求|
|LEGACY-A01|昵称用户名头像分字段，防重复，失败留输入，成功刷新用户 ； 现有资料管理，无逐字段运营开关|待基线复核；保留原验收要求|
|LEGACY-A02|头像预览进度重试清除；关表单不误提交 ； upload.maxMB及频率/归属|待基线复核；保留原验收要求|
|LEGACY-A03|管理员编辑持有版本，冲突提示刷新 ； accounts.read/manage、修改理由|待基线复核；保留原验收要求|
|LEGACY-A04|用户详情资料/状态/资产/规则分区 ； 管理权限与状态服务|待基线复核；保留原验收要求|
|LEGACY-A05|阅读/屏蔽设置加载空值失败分开，重试 ； 个人偏好，非全局审核禁词|待基线复核；保留原验收要求|
|LEGACY-A06|快捷语增删改排序预览、插入保草稿 ； 个人shortcuts，限制共享契约|待基线复核；保留原验收要求|
|LEGACY-A07|字号行距气泡发送习惯预览恢复 ； 用户偏好非运营设置|待基线复核；保留原验收要求|
|LEGACY-A08|邮件发送中失败冷却、过期已用区分 ； 当前仅开发memory投递；拟正式适配器/站点链接；accounts.passwordMinLength|待基线复核；保留原验收要求|
|LEGACY-A09|登录过期保草稿重登回原处 ； accounts.sessionDays、limits.login.perWindow/windowSeconds|待基线复核；保留原验收要求|
|LEGACY-A10|导出注销范围与身份确认、禁止重复 ； 现有关闭规则，无假删除开关|待基线复核；保留原验收要求|
|LEGACY-A11|资产分金币/当前会员/续费/订单，来源可点 ； 原领域投影，不存后台副本|待基线复核；保留原验收要求|
|LEGACY-A12|账本收入支出来源时间筛选、分页及来源跳转 ； grant.signupBonusCoins/dailyCapCoins/perUserDailyCapCoins / 本人账本按方向/来源/日期筛选与分页；会员订单分页与名称快照；邀请金币与分币种佣金展示 ； CoinTransaction/GenerationCharge关联；MembershipOrder.planNameSnapshot；邀请/佣金原台账；未提供虚假提现按钮|待基线复核；保留原验收要求|
|LEGACY-A13|充值按真实套餐展示；关闭禁止支付但可看旧单 ； PaymentCheckoutPolicy.enabled、商户和金币套餐|待基线复核；保留原验收要求|
|LEGACY-A14|待付确认成功失败退款状态，刷新查服务端 ； 套餐快照支付政策，客户端不定到账币|待基线复核；保留原验收要求|
|LEGACY-A15|按目录展示月季年自定义；空为未开放，不填默认假套餐 ； MembershipPlan code/name/durationDays/priceCents/benefitsJson/isActive/sortOrder/version|待基线复核；保留原验收要求|
|LEGACY-A16|对比只列可执行权益、单位范围解释 ； 仅DAILY_FREE_REPLIES/CHAT_PRICE_MULTIPLIER/CHARACTER_CREATE_LIMIT / 权益单位、说明、范围由共享可执行权益定义给前后台；个人订单权益明细按需分页，区分预占/使用/释放；创作额度显示公共/会员及有效来源 ； MembershipPlan/Order/Usage/Grant；本人usage API与creation-quota投影；不复制订单规则|待基线复核；保留原验收要求|
|LEGACY-A17|当前生效与后续续费至分开，显示准确时刻 ； 已购快照，不用当前售价反算|待基线复核；保留原验收要求|
|LEGACY-A18|手动续费不暗示自动扣款，未付显示待付 ； 套餐+订单冻结价格周期权益退款规则|待基线复核；保留原验收要求|
|LEGACY-A19|基础/会员免费来源、已用剩余重置 ； billing.freeDailyMessages/dayTimezone/hardDailyMessages；DAILY_FREE_REPLIES及特例|待基线复核；保留原验收要求|
|LEGACY-A20|模型实际有效价与优惠来源 ； billing.priceMultiplier；CHAT_PRICE_MULTIPLIER；模型币价|待基线复核；保留原验收要求|
|LEGACY-A21|角色已创建/公共上限/有效会员上限说明 ； content.character.maxOwned、CHARACTER_CREATE_LIMIT；公共0不限|待基线复核；保留原验收要求|
|LEGACY-A22|按订单看权益时间数量、预占/已用/释放 ； 服务端事件为准，不前端自加使用数|待基线复核；保留原验收要求|
|LEGACY-A23|退款预估列实付扣除可退截止与依据，确认重算 ； Policy.refundWindowHours/usageChargePeriodHours/version及订单快照|待基线复核；保留原验收要求|
|LEGACY-A24|退款处理中失败完成真实状态，完成回读权益 ； 渠道及退款状态，不前端自行撤权|待基线复核；保留原验收要求|
|LEGACY-A25|超50订单加载更多；购买时名称和规则 ； 已有价格权益政策快照；planName当前读关联名称，拟补快照或明确策略|待基线复核；保留原验收要求|
|LEGACY-A26|停用再删、引用原因、成功回读 ； version/reason；仅停用且未被购买可删|待基线复核；保留原验收要求|
|LEGACY-A27|继承/特例、生效值来源到期、恢复公共 ； registry userOverridable=true才可覆盖|待基线复核；保留原验收要求|
|LEGACY-A28|页面只取所需配置，失败不假参数 ； registry类型范围语义；public-keys白名单|待基线复核；保留原验收要求|
|LEGACY-A29|账号聊天计费会员角色玩法运维分区、搜索、单位0/空说明 ； registry group/label/unit/description/advanced复用 / 聊天分享/建议/成长、发现推荐、上传、费用等设置分小节；小数可编辑；新任务模型引用也阻止误删AI模型 ； 原registry/settings修订与AI引用，不新建第二套设置|待基线复核；保留原验收要求|
|LEGACY-A30|未保存提示、版本冲突重读、恢复预览 ； 修订权限版本；会员独立version|待基线复核；保留原验收要求|
|LEGACY-A31|邀请奖励佣金分开，无提现勿显示可用按钮 ； growth.inviteEnabled/inviteRewardCoins；affiliate.enabled/commissionPercent/eligibleOrderTypes/settlementDelayHours/minimumWithdrawalCents|待基线复核；保留原验收要求|
|LEGACY-A32|AI供应商模型启用引用/可删原因；失败不移除UI ； 模型任务scope币价成本各归其域|待基线复核；保留原验收要求|
|LEGACY-A33|任务点击后真实状态结果，刷新保留、可重跑原因 ； tasks.intervalMs/batchSize/maxAttempts及业务规则|待基线复核；保留原验收要求|
|LEGACY-A34|通知偏好、会员到期/资产提醒、免打扰 ； 拟类别时机；取真实grant，不组件写死几天 / 分类通知偏好、时区免打扰、延期释放、有效目标跳转；会员到期提醒；逐会话主动问候订阅与取消 ； NotificationPreference、Notification.deliveryState/availableAt、ProactiveSubscription；notifications.*、proactive.*、prompt.proactiveGreeting；notification-sweep；AI预算与原子业务日尝试额度，不占聊天日次数|待基线复核；保留原验收要求|
|LEGACY-X01|继续上一条AI回复；拟新增/P2 ； 消息菜单“继续写”，只针对当前有效末条；取消保留已确认内容|待基线复核；保留原验收要求|
|LEGACY-X02|带建议的定向改写；拟新增/P2 ； 输入“更简短/少一些旁白”等建议；预览候选再选用|待基线复核；保留原验收要求|
|LEGACY-X03|回复长度与风格偏好；拟新增/P2 ； 会话设置用易理解选项，说明是引导而非绝对保证|待基线复核；保留原验收要求|
|LEGACY-X04|流式/完整展示偏好；拟新增/P2 ； 用户可选择逐字展示或生成完展示；处理中有状态|待基线复核；保留原验收要求|
|LEGACY-X05|重复回复反馈与有界处理；拟新增/P2 ； 菜单反馈“内容重复”；可重新生成，不伪装成新内容|待基线复核；保留原验收要求|
|LEGACY-X06|单条消息不参与后续上下文；拟新增/P2 ； 菜单选择“后续不参考”；保留聊天记录并显示标记|待基线复核；保留原验收要求|
|LEGACY-X07|对角色的私人设定覆盖；拟新增/P2 ； 设置中写“仅这段对话使用”，可恢复角色默认|待基线复核；保留原验收要求|
|LEGACY-X08|上下文使用说明；拟新增/P2 ； 显示本轮使用的本人记忆/身份及裁剪提示，不公开私有系统提示词|待基线复核；保留原验收要求|
|LEGACY-X09|消息翻译及原文切换；拟新增/P3 ； 显式翻译、语言选择、保留原文；翻译不改剧情历史|待基线复核；保留原验收要求|
|LEGACY-X10|长按菜单与文本选择共存；拟优化/P1 ； 短按无误触；长按菜单有复制/操作；仍能选择文本|待基线复核；保留原验收要求|
|LEGACY-X11|新消息与阅读位置；已有基础，拟完善/P1 ； 上翻时不抢滚动；显示新消息提示，点后定位最新|待基线复核；保留原验收要求|
|LEGACY-X12|聊天时间分隔与消息状态；拟完善/P1 ； 按日期分段，区分待发送、处理中、失败、已保存|待基线复核；保留原验收要求|
|LEGACY-X13|列表滚动与筛选返回恢复；已有基础，拟完善/P1 ； 详情返回恢复原筛选与附近位置；首页刷新有可解释行为|待基线复核；保留原验收要求|
|LEGACY-X14|抽屉未保存变更；拟完善/P1 ； 关闭资料/创作编辑抽屉时提示保留或放弃；只读详情不打扰|待基线复核；保留原验收要求|
|LEGACY-X15|字体/行距/气泡阅读偏好；已有readingMode，拟扩展/P2 ； 提供少量阅读选项、即时预览和恢复默认|待基线复核；保留原验收要求|
|LEGACY-X16|聊天背景个性化；拟新增/P3 ； 系统背景选择或本人图片，预览文字对比；可恢复|待基线复核；保留原验收要求|
|LEGACY-X17|无障碍与减少动画；已有抽屉基础，拟统一/P1 ； 焦点可见、按钮有名称、减少动态、读屏状态提示|待基线复核；保留原验收要求|
|LEGACY-X18|网络中断与重复操作反馈；已有回合幂等，拟统一/P1 ； 保留内容、显示处理中或可重试；不把超时当未保存|待基线复核；保留原验收要求|
|LEGACY-X19|模型不可用切换；已有基础，拟完善/P1 ； 模型下架提示可选替代和费用，用户确认后使用|待基线复核；保留原验收要求|
|LEGACY-X20|语音录制、转写、播放；拟新增/P2 ； 录音权限说明、取消、时长提示、可编辑转写、倍速播放|待基线复核；保留原验收要求|
|LEGACY-X21|角色TTS与声线管理；拟新增/P3 ； 保留现有浏览器朗读；云声线单独说明、生成状态和播放控制|待基线复核；保留原验收要求|
|LEGACY-X22|实时语音通话；拟新增/P3暂缓 ； 接听/挂断、网络状态、麦克风静音、文本回顾|待基线复核；保留原验收要求|
|LEGACY-X23|多人角色聊天；拟新增/P3 ； 选择参与角色、发言顺序、指定发言者、退出/归档|待基线复核；保留原验收要求|
|LEGACY-X24|主动问候与免打扰；拟新增/P2 ； 用户主动订阅、时间窗口、频率选择、暂停；不虚假在线|待基线复核；保留原验收要求|
|LEGACY-X25|纪念日、陪伴记录、角色日记；拟新增/P3暂缓 ； 用户可编辑日期/查看来源、删除日记；区分生成与真实记录|待基线复核；保留原验收要求|
|LEGACY-X26|AI生图与视频任务；拟新增/P3暂缓 ； 提示输入、进度、失败重试、结果保存/删除|待基线复核；保留原验收要求|
|LEGACY-X27|个人数据控制与清理范围；拟完善/P1 ； 删除会话/角色/账号前显示明确范围；导出含可用附件信息|待基线复核；保留原验收要求|
|LEGACY-X28|分享预览与撤销中心；缺口明确/P0-P1 ； 用户选条、预览、确认公开；列出有效链接和撤销|待基线复核；保留原验收要求|
|LEGACY-I01|选条预览、逐条版本校验、确认后生成固定快照、随机分享地址、列表与撤销；旧会话ID不能公开读；原文改删/账号关闭/角色下架使链接失效；不公开私人标题、备注、设定、附件或之后的新消息 ； chat.shareMaxMessages；ConversationShare与源消息摘要；POST必须提交所选消息版本|待基线复核；保留原验收要求|
|LEGACY-I02|服务端全目录搜索、重复tag交集、稳定分页；CMS推荐投影；兴趣即时预览不提前完成引导；开场选择可编辑，进入聊天只填草稿 ； discovery.railLimit/recommendationStrategy、growth.recommendationLimit/openingSuggestions；Tag/HomeSection/Character及onboarding|待基线复核；保留原验收要求|
|LEGACY-I03|记忆关闭、空、失败独立；失败重试；确认转已生效，立即可见；切会话不显示旧结果 ； memory开关、MemoryFact状态与实际上下文注入|待基线复核；保留原验收要求|
|LEGACY-I04|关系模式实际进入上游上下文；后台等级/成长值；成功新回合幂等成长与记录；用户API不得任意改分；前台解释来源 ； relationship.romanceLevels/intimacyLevels/romancePerReply/intimacyPerReply、prompt.relationshipMode；ConversationRelationshipEvent|待基线复核；保留原验收要求|
|LEGACY-I05|前台资料修改/头像清除预览，失败保输入；后台版本冲突不覆盖；阅读设置错误可重试；头像必须是本人受管资源 ； User/accountVersion/UploadAsset；原有accounts.read/manage权限|待基线复核；保留原验收要求|

总计：249个核心登记项、14个内置扩展、66个目录扩展、3个中文生态项目、223个旧编号，合计555个登记记录。这不是555个互不重叠功能：扩展与核心会关联，旧需求也可能重复。
