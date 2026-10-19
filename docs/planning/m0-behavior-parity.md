# M0 普通发送与重生成行为对照

源码：src/app/api/conversations/[id]/messages/route.ts（SEND）；src/app/api/conversations/[id]/messages/[messageId]/regenerate/route.ts（REGEN）；流式逻辑src/lib/conversations/chat-stream.ts。**差异**标注有意不同项。

| 项目 | 普通发送 | 重生成 |
|---|---|---|
| 鉴权 | getAuthUser；未登录401 Unauthorized（route.ts:38-39） | 相同（regenerate/route.ts:40-41） |
| 会话/目标校验 | readConversationForChat(userId,id)（route.ts:41） | 读会话后prepareMessageRegeneration(userId,id,messageId,HISTORY_TURNS)（regenerate/route.ts:43-44）；**差异** |
| 参数校验 | JSON错误400“消息数据格式不正确。”；非字符串或超5000字400“消息须为文本，最多5000字。”；空白400“Message content is required”（route.ts:43-46） | 无请求体校验，目标校验在prepare服务（regenerate/route.ts:43-44）；**差异** |
| 模型可用性 | 空模型计划503“当前角色暂无可用模型，请重新选择模型或联系管理员。”；不可用503“AI服务未配置，暂时无法聊天。”（route.ts:49-52） | 空计划同文案；不可用为“AI服务未配置，暂时无法重新生成回复。”（regenerate/route.ts:47-50）；**差异** |
| 限流 | chat:min:userId与CHAT_LIMIT/WINDOW；429“发送过快，请稍后再试。”并带Retry-After（route.ts:55-62） | 相同文案/头（regenerate/route.ts:53-59） |
| 额度预留 | reserveAiCall(...,'SEND',modelKeys)（route.ts:63-64） | reserveAiCall(...,'REGENERATE',modelKeys)（regenerate/route.ts:60-61）；**差异** |
| 用户消息落库 | createUserMessage，trim后保存（route.ts:66） | 不新增用户消息，使用准备结果（regenerate/route.ts:43-44）；**差异** |
| 历史读取 | 保存后读最近HISTORY_TURNS并排除新用户消息（route.ts:68-73） | 准备目标用户消息之前的上下文（源码注释regenerate/route.ts:23-26，调用43-44）；**差异** |
| 生成 | streamOpenAIResponse或streamMockResponse，以当前文本为输入（route.ts:85-90） | 同一生成器，以prompt.content和准备的history为输入（regenerate/route.ts:75-80） |
| 取消/断流 | request.signal联动AbortController；取消清空assistantContent，finally仍尝试保存并结算CANCELLED；cancel调用onAbort（route.ts:75-114） | 相同模式（regenerate/route.ts:65-104），持久化对象不同 |
| 持久化 | persistAssistantResponse；成功才发[DONE]（route.ts:97-102） | replaceMessageReply；失败/取消保留原回复（regenerate/route.ts:89-92）；**差异** |
| 结算 | finishAiCall映射FAILED/CANCELLED/SUCCEEDED/MOCK并记录metrics（route.ts:100-101） | 相同映射（regenerate/route.ts:90-91） |
| 错误码与生成文案 | aiUserError超时/流不完整/上游失败文案见chat-stream.ts:37-42；route.ts:92-95输出 | 同文案加“ 原回复已保留。”（regenerate/route.ts:82-85）；**差异** |
| 保存错误文案 | “聊天记录保存失败，请刷新后确认。”，PERSISTENCE_ERROR（route.ts:103-106） | “回复保存失败，请刷新后确认。”，PERSISTENCE_ERROR（regenerate/route.ts:93-96）；**差异** |
| HTTP错误 | ConversationError/ConversationMessageError透传status；AiQuotaError用status或429；否则500 Internal server error（route.ts:123-129） | 相同（regenerate/route.ts:113-119） |
| Retry-After | 限流带burst.retryAfter；AiQuotaError仅retryAfter>0带头（route.ts:56-60,126） | 相同（regenerate/route.ts:53-57,116） |

chat-stream候选回退与SSE解析见chat-stream.ts:237-282；两路由都返回text/event-stream/no-cache/keep-alive（SEND route.ts:116-122；REGEN regenerate/route.ts:106-112）。

## 结论
重复编排在路由，不在流式层。差异在输入/历史、SEND与REGENERATE额度类别、追加与替换、用户可见错误文案。此表供服务抽取及M3回归，不能随意统一契约。