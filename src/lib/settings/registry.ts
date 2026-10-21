import type {SettingDefinition, SettingGroup} from './types';

/**
 * 设置登记表：每一项运营可调参数在且只在这里登记一次。
 *
 * 规则（V3 §7/§11）：
 * - 默认值 = 迁移时从当前代码/环境取到的有效值；此后后台为准。
 * - 只有额度、计费模式、折扣倍率与指定玩法次数允许用户覆盖。
 * - 0 / 空 / 关闭的含义按 description 说明，不能一律当成「无限」。
 */
const defs: SettingDefinition[] = [
  // ---------- 聊天与内容 ----------
  {key: 'chat.maxMessageChars', group: 'chat', label: '单条输入字数', type: 'number', unit: '字', default: 5000, min: 1, max: 20000, description: '一次发送最多多少字。超出的请求按 400 拒绝，前后端共用这个值。', userOverridable: false, advanced: false},
  {key: 'chat.historyMessages', group: 'chat', label: '携带历史消息数', type: 'number', unit: '条', default: 20, min: 0, max: 100, description: '生成时带给模型的历史消息条数（不是轮数）。0 表示只带当前输入。', userOverridable: false, advanced: false},
  {key: 'limits.chat.perWindow', group: 'chat', label: '每窗口发送次数', type: 'number', unit: '次', default: 30, min: 1, max: 600, description: '同一用户在一个窗口内最多发送多少次。', userOverridable: false, advanced: false},
  {key: 'limits.chat.windowSeconds', group: 'chat', label: '发送窗口长度', type: 'number', unit: '秒', default: 60, min: 10, max: 3600, description: '频率限制的窗口长度。', userOverridable: false, advanced: true},
  {key: 'billing.hardDailyMessages', group: 'chat', label: '每日请求上限', type: 'number', unit: '次', default: 200, min: 0, max: 5000, description: '含免费与付费的每日请求总数。0 表示暂停新请求，不是无限。', userOverridable: true, advanced: false},
  {key: 'content.post.maxChars', group: 'chat', label: '帖子字数上限', type: 'number', unit: '字', default: 5000, min: 1, max: 50000, description: '发帖正文最多字数。', userOverridable: false, advanced: false},
  {key: 'content.comment.maxChars', group: 'chat', label: '评论字数上限', type: 'number', unit: '字', default: 2000, min: 1, max: 20000, description: '评论正文最多字数。', userOverridable: false, advanced: false},
  {key: 'content.post.maxImages', group: 'chat', label: '帖子图片张数', type: 'number', unit: '张', default: 4, min: 0, max: 9, description: '一条帖子最多附带几张图片。调低不影响已上传文件。', userOverridable: false, advanced: false},
  {key: 'upload.maxMB', group: 'chat', label: '单文件大小上限', type: 'number', unit: 'MB', default: 8, min: 1, max: 50, description: '上传单文件的大小上限。', userOverridable: false, advanced: false},
  {key: 'content.character.nameMax', group: 'chat', label: '角色名称长度', type: 'number', unit: '字', default: 40, min: 1, max: 100, description: '角色名称最多字数。', userOverridable: false, advanced: false},
  {key: 'content.character.summaryMax', group: 'chat', label: '角色简介长度', type: 'number', unit: '字', default: 100, min: 1, max: 1000, description: '角色一句话简介最多字数。', userOverridable: false, advanced: false},
  {key: 'content.character.personaMax', group: 'chat', label: '角色人设长度', type: 'number', unit: '字', default: 1000, min: 1, max: 20000, description: '角色人设最多字数。', userOverridable: false, advanced: false},
  {key: 'content.character.backgroundMax', group: 'chat', label: '角色背景长度', type: 'number', unit: '字', default: 8000, min: 1, max: 40000, description: '角色背景最多字数。当前有效值是 8000，不要按旧文档改成 800。', userOverridable: false, advanced: false},
  {key: 'content.character.openingMax', group: 'chat', label: '开场白长度', type: 'number', unit: '字', default: 2000, min: 1, max: 20000, description: '开场白与场景描述最多字数。', userOverridable: false, advanced: false},
  {key: 'limits.post.perWindow', group: 'chat', label: '每窗口发帖次数', type: 'number', unit: '次', default: 10, min: 1, max: 200, description: '同一用户一个窗口内最多发帖数。', userOverridable: false, advanced: false},
  {key: 'limits.post.windowSeconds', group: 'chat', label: '发帖窗口长度', type: 'number', unit: '秒', default: 600, min: 10, max: 86400, description: '发帖频率窗口长度。', userOverridable: false, advanced: true},
  {key: 'limits.comment.perWindow', group: 'chat', label: '每窗口评论次数', type: 'number', unit: '次', default: 20, min: 1, max: 500, description: '同一用户一个窗口内最多评论数。', userOverridable: false, advanced: false},
  {key: 'limits.comment.windowSeconds', group: 'chat', label: '评论窗口长度', type: 'number', unit: '秒', default: 600, min: 10, max: 86400, description: '评论频率窗口长度。', userOverridable: false, advanced: true},

  // ---------- 计费额度 ----------
  {key: 'billing.chargingEnabled', group: 'billing', label: '聊天收费', type: 'boolean', default: false, description: '开启后新请求按条预扣金币；关闭只停止新预扣，已预扣的按实际结果结算。', userOverridable: false, advanced: false},
  {key: 'billing.freeDailyMessages', group: 'billing', label: '每日免费回复条数', type: 'number', unit: '条', default: 0, min: 0, max: 1000, description: '每天免扣币的回复条数。0 表示没有额外免费条数。', userOverridable: true, advanced: false},
  {key: 'billing.priceMultiplier', group: 'billing', label: '用户收费倍率', type: 'number', unit: '千分比', default: 1000, min: 0, max: 10000, description: '按千分比放大模型币价；0 表示该用户免费。只在用户特例里改。', userOverridable: true, advanced: false},
  {key: 'billing.holdTimeoutMinutes', group: 'billing', label: '冻结检查时间', type: 'number', unit: '分钟', default: 10, min: 1, max: 1440, description: '预扣超过这个时长进入核对；触发检查不代表到时无条件退款。', userOverridable: false, advanced: true},
  {key: 'billing.targetMarginPercent', group: 'billing', label: '目标毛利', type: 'number', unit: '%', default: null, min: 0, max: 95, description: '空表示不生成建议售价；允许负责人自行定价。', userOverridable: false, advanced: true},
  {key: 'billing.marginAlertPercent', group: 'billing', label: '毛利提示线', type: 'number', unit: '%', default: 0, min: 0, max: 100, description: '低于该毛利只在后台提示，不自动停止聊天。', userOverridable: false, advanced: true},
  {key: 'billing.dayTimezone', group: 'billing', label: '日额度时区', type: 'string', default: 'UTC', description: '免费额度按哪个时区切换业务日，界面显示重置时刻。', userOverridable: false, advanced: true},
  {key: 'story.chargingEnabled', group: 'billing', label: '故事回合收费', type: 'boolean', default: false, description: '故事回合是否单独计费；关闭时沿用普通聊天规则。', userOverridable: false, advanced: false},
  {key: 'story.coinPrice', group: 'billing', label: '故事回合币价', type: 'number', unit: '币', default: 0, min: 0, max: 10000, description: '0 表示沿用普通聊天的模型币价。', userOverridable: false, advanced: true},

  // ---------- 增长与玩法 ----------
  {key: 'grant.signupBonusCoins', group: 'growth', label: '注册赠币', type: 'number', unit: '币', default: 100, min: 0, max: 10000, description: '注册时写入的初始金币，注册服务直接读这个值。', userOverridable: false, advanced: false},
  {key: 'grant.dailyCapCoins', group: 'growth', label: '全站日发币上限', type: 'number', unit: '币', default: null, min: 0, max: 1000000, description: '空表示不设额外上限；0 停止全站赠币。', userOverridable: false, advanced: true},
  {key: 'grant.perUserDailyCapCoins', group: 'growth', label: '每人日发币上限', type: 'number', unit: '币', default: null, min: 0, max: 1000000, description: '空表示不设额外上限；0 停止该用户赠币。', userOverridable: true, advanced: true},
  {key: 'mirror.enabled', group: 'growth', label: '他眼中的你', type: 'boolean', default: true, description: '关闭后入口隐藏，已有结果仍可查看。', userOverridable: false, advanced: false},
  {key: 'mirror.questionCount', group: 'growth', label: '题目数量', type: 'number', unit: '题', default: 3, min: 1, max: 6, description: '一次生成需要回答几道题。', userOverridable: false, advanced: false},
  {key: 'mirror.answerMaxChars', group: 'growth', label: '每题字数上限', type: 'number', unit: '字', default: 60, min: 10, max: 500, description: '单题回答最多字数。', userOverridable: false, advanced: false},
  {key: 'mirror.anonymousDailyLimit', group: 'growth', label: '匿名每日次数', type: 'number', unit: '次', default: 1, min: 0, max: 20, description: '未登录用户每天可生成次数。', userOverridable: false, advanced: false},
  {key: 'mirror.userDailyLimit', group: 'growth', label: '登录每日次数', type: 'number', unit: '次', default: 3, min: 0, max: 50, description: '登录用户每天可生成次数。', userOverridable: true, advanced: false},
  {key: 'mirror.compareLimit', group: 'growth', label: '对比角色数量', type: 'number', unit: '个', default: 3, min: 1, max: 6, description: '登录后最多可对比几个角色的结果。', userOverridable: false, advanced: true},
  {key: 'mirror.overLimitPolicy', group: 'growth', label: '超额处理', type: 'enum', default: 'PAUSE', options: [{value: 'PAUSE', label: '暂停生成并提示'}, {value: 'CHARGE', label: '按配置币价购买'}], description: '次数用完后如何处理；选「购买」还要同时开启下面的「开放购买次数」并设好币价。', userOverridable: false, advanced: true},
  {key: 'mirror.purchaseEnabled', group: 'growth', label: '开放购买次数', type: 'boolean', default: false, description: '关闭时超额一律暂停；开启后按「每次超额生成币价」扣币继续生成，只对登录用户生效。', userOverridable: false, advanced: false},
  {key: 'mirror.purchaseCoins', group: 'growth', label: '每次超额生成币价', type: 'number', unit: '币', default: 0, min: 0, max: 100000, description: '超额后继续生成一次要扣多少币；0 表示未定价，即使开启购买也只提示额度用尽。', userOverridable: false, advanced: false},
  {key: 'mirror.purchaseDailyCap', group: 'growth', label: '每日购买上限', type: 'number', unit: '次', default: 0, min: 0, max: 100, description: '同一用户每天最多额外购买几次；0 表示不额外限制，只受余额约束。', userOverridable: false, advanced: true},
  {key: 'mirror.resultRetentionDays', group: 'growth', label: '结果保留天数', type: 'number', unit: '天', default: 30, min: 1, max: 365, description: '匿名结果保留时长；只影响新结果。', userOverridable: false, advanced: true},
  {key: 'mirror.titleMaxChars', group: 'growth', label: '称号字数', type: 'number', unit: '字', default: 8, min: 2, max: 40, description: '结果称号长度上限。', userOverridable: false, advanced: true},
  {key: 'mirror.observationMaxChars', group: 'growth', label: '观察字数', type: 'number', unit: '字', default: 40, min: 10, max: 200, description: '每条观察的长度上限。', userOverridable: false, advanced: true},
  {key: 'mirror.quoteMaxChars', group: 'growth', label: '金句字数', type: 'number', unit: '字', default: 30, min: 5, max: 120, description: '结果金句长度上限。', userOverridable: false, advanced: true},
  {key: 'dispute.enabled', group: 'growth', label: '评理广场', type: 'boolean', default: true, description: '关闭后停止新发起，已有案例按创建时的规则结束。', userOverridable: false, advanced: false},
  {key: 'dispute.dailyLimit', group: 'growth', label: '每日发起次数', type: 'number', unit: '次', default: 3, min: 0, max: 20, description: '同一用户每天最多发起几个案例。', userOverridable: true, advanced: false},
  {key: 'dispute.minAccountAgeHours', group: 'growth', label: '注册时长要求', type: 'number', unit: '小时', default: 24, min: 0, max: 720, description: '注册满多少小时才能发起。', userOverridable: false, advanced: true},
  {key: 'dispute.maxExcerptMessages', group: 'growth', label: '最多摘录消息', type: 'number', unit: '条', default: 6, min: 2, max: 20, description: '发起时最多选择几条连续消息作为摘录。', userOverridable: false, advanced: false},
  {key: 'dispute.claimMaxChars', group: 'growth', label: '诉求字数', type: 'number', unit: '字', default: 60, min: 10, max: 500, description: '诉求正文长度上限。', userOverridable: false, advanced: false},
  {key: 'dispute.maxVoteChanges', group: 'growth', label: '可改票次数', type: 'number', unit: '次', default: 1, min: 0, max: 5, description: '一人一票，允许改票的次数。', userOverridable: false, advanced: true},
  {key: 'dispute.closeAfterHours', group: 'growth', label: '结案时长', type: 'number', unit: '小时', default: 48, min: 1, max: 336, description: '到点自动结案；创建时写入规则快照，改配置不影响已开案例。', userOverridable: false, advanced: false},
  {key: 'dispute.closeAtVotes', group: 'growth', label: '提前结案票数', type: 'number', unit: '票', default: 200, min: 1, max: 100000, description: '票数先到也结案。', userOverridable: false, advanced: true},
  {key: 'dispute.verdictMaxChars', group: 'growth', label: '角色回应字数', type: 'number', unit: '字', default: 120, min: 20, max: 800, description: '结案时角色回应长度上限。', userOverridable: false, advanced: true},
  {key: 'memory.enabled', group: 'growth', label: '聊天记忆', type: 'boolean', default: false, description: '开启后才生成滚动摘要与关键事实；关闭时不再注入。', userOverridable: false, advanced: false},
  {key: 'memory.summaryTriggerMessages', group: 'growth', label: '摘要触发消息数', type: 'number', unit: '条', default: 20, min: 4, max: 200, description: '会话累计多少条新消息后触发摘要任务。', userOverridable: false, advanced: true},
  {key: 'memory.summaryMaxChars', group: 'growth', label: '摘要长度', type: 'number', unit: '字', default: 1000, min: 100, max: 4000, description: '滚动摘要的长度上限。', userOverridable: false, advanced: true},
  {key: 'memory.maxFacts', group: 'growth', label: '注入事实条数', type: 'number', unit: '条', default: 10, min: 0, max: 50, description: '生成时最多注入多少条有效事实。', userOverridable: false, advanced: true},
  {key: 'memory.contextBudgetTokens', group: 'growth', label: '上下文预算', type: 'number', unit: 'token', default: 8000, min: 500, max: 64000, description: '角色设定＋事实＋摘要＋近期消息的总预算。', userOverridable: false, advanced: true},
  {key: 'tasks.intervalMs', group: 'growth', label: '任务轮询间隔', type: 'number', unit: '毫秒', default: 15000, min: 5000, max: 300000, description: '后台任务入口的轮询间隔。', userOverridable: false, advanced: true},
  {key: 'tasks.batchSize', group: 'growth', label: '每批处理数', type: 'number', unit: '个', default: 10, min: 1, max: 100, description: '一次轮询最多处理多少个任务。', userOverridable: false, advanced: true},
  {key: 'tasks.maxAttempts', group: 'growth', label: '有限重试次数', type: 'number', unit: '次', default: 3, min: 1, max: 10, description: '任务失败后的重试上限，超过后置 FAILED 并在后台可见。', userOverridable: false, advanced: true},
  {key: 'tasks.backupRetention', group: 'growth', label: '备份保留份数', type: 'number', unit: '份', default: 7, min: 1, max: 60, description: '备份清理任务每次从数据库读取该保留策略。', userOverridable: false, advanced: true},

  // ---------- 账号运行 ----------
  {key: 'accounts.passwordMinLength', group: 'accounts', label: '注册密码最少位数', type: 'number', unit: '位', default: 6, min: 4, max: 32, description: '普通注册规则；超级管理员既有密码不受影响。', userOverridable: false, advanced: false},
  {key: 'accounts.sessionDays', group: 'accounts', label: '会话有效天数', type: 'number', unit: '天', default: 7, min: 1, max: 90, description: '新签发登录会话的有效期。', userOverridable: false, advanced: false},

  // ---------- 提示词 ----------
  {key: 'prompt.mirror', group: 'prompts', label: '他眼中的你提示词', type: 'text', default: '你是一个观察者。根据用户对三道题的回答，给出称号、三条观察、一句金句和两个娱乐指数。只输出 JSON。', description: '模板里可用的占位符见设置页说明；保存前可用「试生成」检查一条结果。', userOverridable: false, advanced: false},
  {key: 'prompt.disputeVerdict', group: 'prompts', label: '评理结案提示词', type: 'text', default: '你是中立的旁观者。阅读双方摘录与票数，写一段简短、不站队的人身评价。', description: '结案时生成角色回应的提示词。', userOverridable: false, advanced: false},
  {key: 'prompt.memorySummary', group: 'prompts', label: '记忆摘要提示词', type: 'text', default: '把下面这段对话压缩成事实摘要，只保留人物关系、约定与明确发生的事，不要编造。', description: '普通聊天摘要任务的提示词。', userOverridable: false, advanced: false},
];

export const SETTINGS: SettingDefinition[] = defs;
export const SETTINGS_BY_KEY: Record<string, SettingDefinition> = Object.fromEntries(defs.map(d => [d.key, d]));
export const SETTING_GROUPS: {id: SettingGroup; label: string}[] = [
  {id: 'chat', label: '聊天与内容'},
  {id: 'billing', label: '计费额度'},
  {id: 'growth', label: '增长玩法'},
  {id: 'accounts', label: '账号运行'},
  {id: 'prompts', label: '提示词'},
];

export function definitionsOfGroup(group: SettingGroup): SettingDefinition[] {
  return defs.filter(d => d.group === group);
}

export function isSettingGroup(value: string): value is SettingGroup {
  return SETTING_GROUPS.some(group => group.id === value);
}

export function isUserOverridable(key: string): boolean {
  return SETTINGS_BY_KEY[key]?.userOverridable === true;
}
