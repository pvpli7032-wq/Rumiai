import {definitionsOfGroup} from '@/lib/settings/registry';
import type {SettingDefinition, SettingGroup} from '@/lib/settings/types';

/**
 * 分类内的小节。
 *
 * V3 §16 要求每个分类先呈现 6 至 10 个常用项：把一整类几十个键平铺在一张卡片里
 * 会变成长表单，所以按主题再分小节，每节只放常用项，高级项折叠在小节底部。
 * 小节只做展示分组，键名、默认值与校验仍以 registry 为准。
 */
export interface SettingsSection {
  id: string;
  title: string;
  description?: string;
  definitions: SettingDefinition[];
}

interface SectionRule {
  id: string;
  title: string;
  description?: string;
  matches: (key: string) => boolean;
}

const RULES: Record<SettingGroup, SectionRule[]> = {
  chat: [
    {
      id: 'chat-input',
      title: '聊天输入与发送',
      description: '单条输入、携带历史、发送频率与每日请求上限。',
      matches: key => key.startsWith('chat.') || key.startsWith('limits.chat.') || key === 'billing.hardDailyMessages',
    },
    {
      id: 'chat-content',
      title: '帖子与评论',
      description: '社区内容长度、图片张数与发帖评论频率。',
      matches: key => /^(content.(post|comment).|limits.(post|comment).)/.test(key),
    },
    {
      id: 'chat-character',
      title: '角色与上传',
      description: '角色资料各段字数上限，以及单文件上传大小。',
      matches: key => key.startsWith('content.character.') || key.startsWith('upload.'),
    },
    {
      id: 'chat-limits',
      title: '其他操作频率',
      description: '上传、关注、举报与登录的频率限制，全部是高级项，默认折叠。',
      matches: key => /^limits\.(upload|follow|report|login)\./.test(key),
    },
  ],
  billing: [
    {
      id: 'billing-price',
      title: '收费开关与价格',
      description: '聊天与故事是否收费，以及每条回复的价格口径。',
      matches: key => ['billing.chargingEnabled', 'billing.freeDailyMessages', 'billing.priceMultiplier', 'story.chargingEnabled', 'story.coinPrice'].includes(key),
    },
    {
      id: 'billing-settlement',
      title: '结算与额度规则',
      description: '预扣核对、取消策略、毛利提示与业务日时区。',
      matches: key => key.startsWith('billing.') || key.startsWith('story.'),
    },
  ],
  growth: [
    {
      id: 'growth-grant',
      title: '赠币',
      description: '注册赠币与全站、单人的日发币上限。',
      matches: key => key.startsWith('grant.'),
    },
    {
      id: 'growth-mirror',
      title: '他眼中的你',
      description: '入口开关、题目与次数额度、结果保留。',
      matches: key => key.startsWith('mirror.'),
    },
    {
      id: 'growth-dispute',
      title: '评理广场',
      description: '发起资格、投票与结案规则。',
      matches: key => key.startsWith('dispute.'),
    },
    {
      id: 'growth-memory',
      title: '记忆与后台任务',
      description: '聊天记忆的摘要与注入预算，以及后台任务轮询参数。',
      matches: key => key.startsWith('memory.') || key.startsWith('tasks.'),
    },
  ],
  accounts: [
    {
      id: 'accounts-login',
      title: '登录与账号',
      description: '注册密码强度与会话有效期。',
      matches: key => key.startsWith('accounts.'),
    },
  ],
  prompts: [
    {
      id: 'prompts-templates',
      title: '提示词模板',
      description: '新玩法与记忆任务的提示词；保存后下一次生成生效。',
      matches: key => key.startsWith('prompt.'),
    },
  ],
};

/**
 * 设置中心要展示的定义。
 *
 * 登记表是唯一的读取与校验来源，但 `hidden` 的键有专属编辑位置（例如任务用模型在
 * 「价格与成本」页用下拉选），不在设置中心重复出现（V3 表 6「每项只在一个位置编辑」）。
 * 分组渲染、常用项计数、设置搜索都从这里取，漏一处就等于没隐藏。
 */
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

  // 新增键若暂时没有小节规则，也要显示出来，不能因为漏配规则而悄悄消失。
  const rest = definitions.filter(definition => !used.has(definition.key));
  if (rest.length) sections.push({id: 'other', title: '其他设置', definitions: rest});
  return sections;
}
