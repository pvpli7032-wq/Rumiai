# 第一阶段API契约

以下“新增/扩展”为拟定接口。已有端点不随意更名；实现先更新contracts，再后端、API、前后台。普通用户接口使用现有登录认证；管理接口使用独立后台认证及服务端permission校验，不因隐藏按钮就省略权限。所有资源查询带owner范围，非本人资源返回404；未登录401；后台无权限403。

新接口错误形状沿现有error字段保持客户端兼容，并添加code、details可选字段：`{error:"可显示文案",code:"VERSION_CONFLICT",details:{currentVersion:3}}`。成功不额外套一层与既有风格冲突的data。列表`{items,nextCursor}`，limit默认20、最大100；游标用稳定时间+id，服务端校验。以下默认值为接口技术限制，不是收费参数。

## 现有端点扩展

|方法和路径|变更|请求/响应要点|
|---|---|---|
|GET /api/conversations/{id}/context|扩展|返回presetRevision、生成覆盖、兼容状态；不得发平台隐藏提示|
|PATCH /api/conversations/{id}/context|扩展现有PATCH|新增promptPresetRevisionId、generationOverrides；本人绑定；旧身份/书绑定兼容|
|GET /api/conversations/{id}/context/usage|扩展|requestId+operation可选；sources、tokenCount、countQuality、omittedReasons、compilerVersion|
|GET/POST /api/me/worldbooks|沿用列表/新建|扩展extensions与version规则|
|GET/PUT/DELETE /api/me/worldbooks/{id}|沿用现有方法|书CAS、引用影响、未知字段保留|
|POST /api/me/worldbooks/{id}/entries|扩展|基础字段+constant/secondaryKeys/logic/matchMode/case/wholeWord/scanDepth/position/role|
|PUT/DELETE /api/me/worldbooks/{id}/entries/{entryId}|扩展|version必传；成功返回entry与bookVersion|
|POST /api/conversations/{id}/branches|扩展|现有messageId；增加manualFactsPolicy:"COPY_CURRENT"显式默认策略说明|
|POST /api/characters；PUT /api/characters/{id}|内部扩展|roleplayProfile作为有权限的可选字段；保持原创作审核和配额|
|PATCH /api/admin/ai/models/{id}|扩展|contextWindowTokens/tokenizerKey/generationCapabilities；version/reason走原审计|

已核对当前route.ts：会话context用PATCH，世界书和条目用PUT；本页新增字段尚未实现。不得同时留下PATCH/PUT两套不同业务。

## 新增提示词预设与诊断

|接口|输入|输出/规则|
|---|---|---|
|GET /api/me/prompt-presets|cursor/limit/includeArchived|本人列表及已发布平台模板的安全投影|
|POST /api/me/prompt-presets|name、description、blocks、generation|201 {id,version:0,revisionId,revision:1}|
|GET /api/me/prompt-presets/{id}|无|当前版与历史修订摘要|
|PATCH /api/me/prompt-presets/{id}|version、name?、blocks?、generation?|新修订；409旧版本不覆盖|
|DELETE /api/me/prompt-presets/{id}|version|204；仍有会话引用409 PRESET_IN_USE，提示归档|
|POST /api/conversations/{id}/context/preview|input?、operation、draftOverrides?|{blocks,sources,tokenUsage,warnings,omitted}；不调用模型、不预扣、不写消息|
|GET /api/admin/chat/prompt-templates|分页|settings.read；只平台模板|
|POST/PATCH /api/admin/chat/prompt-templates[/{id}]|模板内容、version、reason|settings.write；发布通过isPublished显式控制并审计|

预览中的blocks只返回用户有权查看的内容；平台/角色非本人隐藏块只显示类型、长度/来源标记，不泄漏明文。预览与正式生成调用同一个编译器；正式生成记录实际快照，不能用预览结果冒充当轮实际请求。预览输出不含供应商密钥/baseUrl私有配置。

## 世界书试运行

POST /api/me/worldbooks/{id}/preview，输入`{text,history:[{role,content,contextIncluded}],draftEntries?}`；history只当用户提交的临时文本，不允许借此指定别人的messageId读取历史。返回每条`{entryId,matched,reason,position,role,estimatedTokens}`及总预算/裁剪。reason枚举DISABLED/NO_PRIMARY/SECONDARY_FAILED/UNSUPPORTED/BUDGET/INCLUDED。会话真实诊断需走context/preview并由服务端加载历史。

## 正则规则

|接口|输入|输出/规则|
|---|---|---|
|GET /api/me/regex-rules|scope、characterId?/conversationId?、stage、分页|本人规则及顺序|
|POST /api/me/regex-rules|name/scope/绑定/stage/pattern/flags/replacement/enabled/sortOrder|201 {rule,version}；表达式受限编译成功才保存|
|PATCH /api/me/regex-rules/{id}|version、变更字段|CAS，移动作用域重新鉴权|
|DELETE /api/me/regex-rules/{id}|version|204；历史快照仍保留|
|POST /api/me/regex-rules/preview|规则草稿、text|{output,matches,warnings}；不存消息、不调用模型|
|POST /api/me/regex-rules/reorder|scope/绑定/stage、items:[{id,version,sortOrder}]|事务修改，遗漏/跨归属/重复id拒绝|

受限引擎、输入长度、规则数量和输出膨胀上限由后端设置限定；不支持表达式返回422 REGEX_UNSUPPORTED并定位pattern字段，不静默退回无限回溯JS RegExp。

## 通用导入两步协议

导入预览走同一生命周期服务，格式转换仍归各业务域，不做一个巨型import模块。

|接口|输入|输出|
|---|---|---|
|POST /api/me/imports/preview|multipart：file、kind、requestId；targetId/targetVersion可选|201 {id,status:"PREVIEW",digest,expiresAt,summary,fieldMapping,warnings,unsupported,canConfirm}|
|GET /api/me/imports/{id}|无|本人任务、报告、确认结果|
|POST /api/me/imports/{id}/confirm|{requestId,digest,mode:"CREATE"/"REPLACE_OWN",targetId?,targetVersion?,acceptDegraded:false}|{status:"CONFIRMED",result:{kind,id,url},warnings}|
|DELETE /api/me/imports/{id}|无|未确认预览可取消，清理临时资产；已确认不删除实体|

preview requestId与confirm使用同一任务身份；数据库唯一键ownerId+requestId。同号不同digest返回409 IDEMPOTENCY_CONFLICT；重复确认返回原结果；过期410 IMPORT_EXPIRED；unsupported活跃功能422 IMPORT_UNSUPPORTED，只有列明支持的降级路径且用户显式acceptDegraded才可创建降级副本。V3/CharX、群聊/故事JSONL第一阶段不可通过降级伪装普通完整导入。

大小/格式检测同时用文件签名与解析器；错误报告列字段路径/行号。PNG只接受合法图片及chara元数据；JSONL每行校验，任何非法消息使整批确认失败。外链URL仅保留说明，不能借导入触发服务器抓取。替换只允许本人角色/书/预设，校验version与原额度/审核策略；无权限绝不通过source creator字段绕过。

## 导出接口

|接口|查询|约束|
|---|---|---|
|GET /api/characters/{id}/card-export|format=json/png|本人或按原角色下载政策允许；不默认允许导出私有提示|
|GET /api/me/worldbooks/{id}/export|format=st-json|所有权，原uid+unknown字段保留|
|GET /api/me/prompt-presets/{id}/export|format=st-cc|只允许支持子集，响应附件并附兼容版本|
|GET /api/me/regex-rules/export|scope/绑定|本人规则，不含凭据|
|GET /api/conversations/{id}/export|format=st-jsonl|复用已有导出路由时增加格式参数；仅普通本人会话|

导出错误先返回JSON错误，不能200空文件。文件名由服务端净化。导出只包含业务内容，不包含Cookie、密钥、账单、后台审计、其他用户数据或平台隐藏块。未知字段保留不覆盖当前编辑后的规范字段。

## 标准失败场景

400结构不合法；401未登录；403后台无权限；404资源不属于用户/不存在；409版本、引用、幂等冲突；410导入过期；413文件超限；422字段/格式/模型能力不支持；429频率限制；503新能力未配置或关闭。错误不得把原始密钥/完整系统prompt回显。客户端失败保留草稿；未知网络结果用原requestId查任务，不自动生成新ID重试写入。
