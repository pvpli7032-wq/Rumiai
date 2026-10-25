import {definitionsOfGroup} from '@rumiai/contracts/settings/registry';
import type {SettingDefinition, SettingGroup} from '@rumiai/contracts/settings/types';

/** 展示分区只负责导航；registry、API 分组、默认值和生效规则不在这里复制。 */
export interface SettingsSection {
  id: string;
  title: string;
  description?: string;
  definitions: SettingDefinition[];
}

interface SectionRule {
  id: string;
  title: string;
  description: string;
  matches: (key: string) => boolean;
}

const starts = (...prefixes: string[]) => (key: string) => prefixes.some(prefix => key.startsWith(prefix));
const exact = (...keys: string[]) => (key: string) => keys.includes(key);
const either = (...rules: Array<(key: string) => boolean>) => (key: string) => rules.some(rule => rule(key));

/** 展示目录的唯一规则表。未匹配的新 registry 键会落入「其他设置」，不会静默丢失。 */
const RULES: Record<SettingGroup, SectionRule[]> = {
  chat: [
    {id:'chat-scenes',title:'角色场景目录',description:'管理可用场景、玩家身份、目标与开场；内容由生成服务实际读取。',matches:exact('chat.scenes')},
    {id: 'chat-media', title: '图片理解与录音', description: '媒体任务开关、每日次数与录音时长；模型和预算在AI平台配置。', matches: starts('media.')},
    {id: 'chat-revisions', title: '续写与改写', description: '开放状态、计费方式与改写要求长度。', matches: starts('chat.revisions.')},
    {id: 'chat-context', title: '身份与世界书', description: '用户身份、私人角色补充和世界书注入上限。', matches: either(starts('chat.worldbooks.'), exact('chat.personaMaxChars', 'chat.personalOverrideMaxChars'))},
    {id: 'chat-response', title: '回复风格与长度', description: '配置用户可选的回复方式，后台指令不公开。', matches: exact('chat.responseStyles', 'chat.responseLengths')},
    {id: 'chat-input', title: '聊天输入与回复', description: '输入长度、历史消息、回复次数与聊天限流。', matches: either(starts('limits.chat.'), exact('chat.maxMessageChars', 'chat.historyMessages', 'billing.hardDailyMessages'))},
    {id: 'chat-relationship', title: '关系与成长', description: '关系等级、每次有效回复的成长值；关系模式提示词在提示词分类维护。', matches: starts('relationship.')},
    {id: 'chat-sharing', title: '聊天分享', description: '分享选取范围；公开链接由授权快照控制，后续私聊不会自动公开。', matches: starts('chat.share')},
    {id: 'chat-suggestions', title: '接话建议', description: '建议开关、数量、长度和每日使用上限；模型与预算分别在对应设置维护。', matches: starts('chat.suggestions.')},
    {id: 'chat-posts', title: '帖子', description: '帖子长度、图片数量和发帖频率。', matches: starts('content.post.', 'limits.post.')},
    {id: 'chat-comments', title: '评论', description: '评论长度和评论频率。', matches: starts('content.comment.', 'limits.comment.')},
    {id: 'chat-characters', title: '角色资料', description: '角色名称、简介、人设、背景与开场白长度。', matches: starts('content.character.')},
    {id: 'chat-upload', title: '上传', description: '文件大小与上传频率限制。', matches: starts('upload.', 'limits.upload.')},
    {id: 'chat-frequency', title: '其他频率限制', description: '关注、举报和登录等操作的窗口与次数。', matches: starts('limits.follow.', 'limits.report.', 'limits.login.')},
  ],
  billing: [
    {id: 'billing-base', title: '聊天收费与免费额度', description: '收费状态、基础免费回复与公共价格系数；会员权益在会员管理维护。', matches: exact('billing.chargingEnabled', 'billing.freeDailyMessages', 'billing.priceMultiplier')},
    {id: 'billing-cancel', title: '取消回复', description: '取消生成后的费用处理与每天免费取消次数；聊天输入区读取同一政策。', matches: exact('billing.cancelPolicy', 'billing.freeCancelPerDay')},
    {id: 'billing-settlement', title: '结算与额度', description: '预扣核对、毛利提示、业务日和其他结算口径。', matches: exact('billing.holdTimeoutMinutes', 'billing.targetMarginPercent', 'billing.marginAlertPercent', 'billing.dayTimezone')},
    {id: 'billing-story', title: '故事入口与收费', description: '故事入口、故事回合收费和故事币价。', matches: exact('story.enabled', 'story.chargingEnabled', 'story.coinPrice')},
    {id: 'billing-story-settings', title: '玩家设定与叙事方式', description: '前台故事场景设置的长度和可选叙事方式；保存后由故事生成服务执行。', matches: exact('story.settingsMaxChars', 'story.narrativeStyles')},
    {id: 'billing-story-runtime', title: '故事运行参数', description: '故事模板、动作建议、状态批处理和重试参数。', matches: starts('story.enabledTemplates', 'story.actionSuggestions', 'story.stateBatchSize', 'story.stateMaxAttempts')},
    {id: 'billing-cost', title: '成本与汇率', description: '成本币汇率和建议价格样本口径；模型成本价格在专页维护。', matches: starts('cost.')},
    {id: 'billing-ai-budget', title: '各类 AI 任务预算', description: '按聊天、故事、Mirror、评理和记忆任务分别设置成本预算。', matches: starts('budget.task.')},
  ],
  growth: [
    {id: 'growth-notifications', title: '站内通知与到期提醒', description: '会员提醒开放与提前时间，尊重用户免打扰偏好。', matches: starts('notifications.')},
    {id: 'growth-proactive', title: '角色主动问候', description: '订阅上限、发送间隔和每日数量，须用户主动订阅。', matches: starts('proactive.')},
    {id: 'growth-grant', title: '赠币', description: '注册赠币与全站、单用户日发币上限。', matches: starts('grant.')},
    {id: 'growth-onboarding', title: '首次进入与兴趣推荐', description: '新手引导开关、可选兴趣与可编辑开场短句；参数由前台引导和服务端推荐共同读取。', matches: exact('growth.onboardingEnabled', 'growth.interestTags', 'growth.openingSuggestions')},
    {id: 'growth-discovery', title: '发现与推荐', description: '推荐分区数量和已支持的推荐策略；首次进入的推荐数量单独配置。', matches: either(starts('discovery.'), exact('growth.recommendationLimit'))},
    {id: 'growth-invite', title: '邀请入口与奖励', description: '邀请开放、奖励和增长事件保留；返佣另在一级分销维护。', matches: exact('growth.inviteEnabled', 'growth.inviteRewardCoins', 'growth.eventRetentionDays')},
    {id: 'growth-affiliate', title: '一级分销', description: '直接上级佣金比例、参与订单、结算等待与人工处理门槛；修改仅影响新订单。', matches: starts('affiliate.')},
    {id: 'growth-mirror-entry', title: 'Mirror 使用额度', description: '他眼中的你入口、题目数量、匿名与登录次数。', matches: exact('mirror.enabled', 'mirror.questionCount', 'mirror.answerMaxChars', 'mirror.anonymousDailyLimit', 'mirror.userDailyLimit', 'mirror.compareLimit')},
    {id: 'growth-mirror-purchase', title: 'Mirror 超额与购买', description: '超额处理、购买价格、购买上限和匿名 IP 限制。', matches: exact('mirror.overLimitPolicy', 'mirror.purchaseEnabled', 'mirror.purchaseCoins', 'mirror.purchaseDailyCap', 'mirror.anonymousIpDailyLimit')},
    {id: 'growth-mirror-content', title: 'Mirror 内容与结果', description: '推广角色、问题、观察风格、结果版式与保留规则。', matches: starts('mirror.featuredCharacterIds', 'mirror.observationStyle', 'mirror.resultLayout', 'mirror.questions', 'mirror.exampleResults', 'mirror.resultRetentionDays', 'mirror.titleMaxChars', 'mirror.observationMaxChars', 'mirror.quoteMaxChars')},
    {id: 'growth-dispute-entry', title: '评理发起', description: '入口、发起次数、账号年龄、摘录消息和诉求限制。', matches: starts('dispute.enabled', 'dispute.dailyLimit', 'dispute.minAccountAgeHours', 'dispute.maxExcerptMessages', 'dispute.claimMaxChars')},
    {id: 'growth-dispute-resolution', title: '评理投票与奖励', description: '改票、结案、角色回应与投票奖励。', matches: starts('dispute.maxVoteChanges', 'dispute.closeAfterHours', 'dispute.closeAtVotes', 'dispute.verdictMaxChars', 'dispute.participateRewardCoins', 'dispute.hotRewardCoins', 'dispute.hotRewardTopN', 'dispute.rewardDailyCapCoins')},
    {id: 'growth-memory', title: '聊天记忆', description: '记忆开关、摘要触发、事实注入和上下文预算。', matches: starts('memory.')},
    {id: 'growth-tasks', title: '后台任务', description: '任务轮询、批处理、重试和备份保留。', matches: starts('tasks.')},
  ],
  accounts: [{id: 'accounts-login', title: '登录与账号', description: '注册密码强度与登录会话有效期。', matches: starts('accounts.')}],
  prompts: [{id:'prompts-memory',title:'记忆摘要提示词',description:'自动摘要整理对话时使用的指令。',matches:exact('prompt.memorySummary')}, {id: 'prompts-templates', title: '提示词模板', description: 'Mirror、评理结案、记忆摘要与接话建议的提示词。', matches: starts('prompt.')}],
};

export function visibleDefinitionsOfGroup(group: SettingGroup): SettingDefinition[] {
  return definitionsOfGroup(group).filter(definition => !definition.hidden);
}

export function sectionsOfGroup(group: SettingGroup): SettingsSection[] {
  const definitions = visibleDefinitionsOfGroup(group);
  const used = new Set<string>();
  const sections: SettingsSection[] = [];
  for (const rule of RULES[group]) {
    const matched = definitions.filter(definition => !used.has(definition.key) && rule.matches(definition.key));
    if (!matched.length) continue;
    matched.forEach(definition => used.add(definition.key));
    sections.push({id: rule.id, title: rule.title, description: rule.description, definitions: matched});
  }
  const rest = definitions.filter(definition => !used.has(definition.key));
  if (rest.length) sections.push({id: 'other', title: '其他设置', description: '新增参数暂未归入专门分区，请核对其说明。', definitions: rest});
  return sections;
}

export function sectionForKey(group: SettingGroup, key: string): SettingsSection | undefined {
  return sectionsOfGroup(group).find(section => section.definitions.some(definition => definition.key === key));
}

/** 供无网络测试使用：可见 registry 键必须且只能出现一次。 */
export function sectionCoverage(group: SettingGroup) {
  const sections = sectionsOfGroup(group);
  const keys = sections.flatMap(section => section.definitions.map(definition => definition.key));
  const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);
  const missing = visibleDefinitionsOfGroup(group).map(definition => definition.key).filter(key => !keys.includes(key));
  return {total: keys.length, unique: new Set(keys).size, duplicates, missing, sections};
}
