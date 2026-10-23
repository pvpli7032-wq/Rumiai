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
    {id: 'chat-input', title: '聊天输入与回复', description: '输入长度、历史消息、回复次数与聊天限流。', matches: either(starts('chat.', 'limits.chat.'), exact('billing.hardDailyMessages'))},
    {id: 'chat-posts', title: '帖子', description: '帖子长度、图片数量和发帖频率。', matches: starts('content.post.', 'limits.post.')},
    {id: 'chat-comments', title: '评论', description: '评论长度和评论频率。', matches: starts('content.comment.', 'limits.comment.')},
    {id: 'chat-characters', title: '角色资料', description: '角色名称、简介、人设、背景与开场白长度。', matches: starts('content.character.')},
    {id: 'chat-upload', title: '上传', description: '文件大小与上传频率限制。', matches: starts('upload.')},
    {id: 'chat-frequency', title: '其他频率限制', description: '关注、举报和登录等操作的窗口与次数。', matches: starts('limits.upload.', 'limits.follow.', 'limits.report.', 'limits.login.')},
  ],
  billing: [
    {id: 'billing-base', title: '计费基础', description: '聊天收费、免费回复、价格系数与取消策略。', matches: exact('billing.chargingEnabled', 'billing.freeDailyMessages', 'billing.priceMultiplier', 'billing.cancelPolicy', 'billing.freeCancelPerDay')},
    {id: 'billing-settlement', title: '结算与额度', description: '预扣核对、毛利提示、业务日和其他结算口径。', matches: exact('billing.holdTimeoutMinutes', 'billing.targetMarginPercent', 'billing.marginAlertPercent', 'billing.dayTimezone')},
    {id: 'billing-story', title: '故事入口与收费', description: '故事入口、故事回合收费和故事币价。', matches: exact('story.enabled', 'story.chargingEnabled', 'story.coinPrice')},
    {id: 'billing-story-runtime', title: '故事运行参数', description: '故事模板、动作建议、状态批处理和重试参数。', matches: starts('story.enabledTemplates', 'story.actionSuggestions', 'story.stateBatchSize', 'story.stateMaxAttempts')},
    {id: 'billing-cost', title: '成本与汇率', description: '成本币汇率和建议价格样本口径；模型成本价格在专页维护。', matches: starts('cost.')},
    {id: 'billing-ai-budget', title: '各类 AI 任务预算', description: '按聊天、故事、Mirror、评理和记忆任务分别设置成本预算。', matches: starts('budget.task.')},
  ],
  growth: [
    {id: 'growth-grant', title: '赠币', description: '注册赠币与全站、单用户日发币上限。', matches: starts('grant.')},
    {id: 'growth-invite', title: '引导与邀请', description: '新手引导、兴趣标签、邀请入口与奖励。', matches: either(starts('growth.onboardingEnabled', 'growth.interestTags', 'growth.inviteEnabled', 'growth.inviteRewardCoins'), exact('growth.eventRetentionDays'))},
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
  prompts: [{id: 'prompts-templates', title: '提示词模板', description: 'Mirror、评理结案与记忆摘要的提示词。', matches: starts('prompt.')}],
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
