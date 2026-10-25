/**
 * 前台公开设置白名单（V3 §7）。
 *
 * 单独成文件是为了让客户端也能引用同一份清单：前端用它算默认值与字段名，
 * 服务端用它决定 /api/ui-config 返回什么。**只**放前台真正需要的规则项，
 * 成本、毛利、任务、审核、密钥类设置永远不进这里。
 */
export const PUBLIC_KEYS = [
  'proactive.enabled', 'proactive.maxSubscriptions', 'proactive.minIntervalHours', 'proactive.maxPerUserDaily', 'proactive.maxMessageChars', 'notifications.membershipReminderEnabled',
  'chat.maxMessageChars', 'chat.historyMessages', 'content.post.maxChars', 'content.comment.maxChars',
  'content.post.maxImages', 'upload.maxMB', 'content.character.nameMax', 'content.character.summaryMax',
  'content.character.personaMax', 'content.character.backgroundMax', 'content.character.openingMax', 'content.character.maxOwned',
  'accounts.passwordMinLength', 'billing.chargingEnabled', 'billing.freeDailyMessages', 'mirror.enabled',
  'dispute.enabled', 'mirror.questionCount', 'mirror.answerMaxChars', 'dispute.claimMaxChars',
] as const;

export type PublicSettingKey = (typeof PUBLIC_KEYS)[number];
