import type {AdminPermission} from './permissions';

/** 后台侧栏、面包屑、栏目搜索和工作台入口共用的唯一导航树。 */
export type AdminNavIcon =
  | 'dashboard' | 'characters' | 'moderation' | 'circles' | 'posts' | 'comments'
  | 'accounts' | 'analytics' | 'growth' | 'site-content' | 'finance' | 'memberships'
  | 'merchants' | 'ai-providers' | 'ai-models' | 'ai-costs' | 'operations' | 'compliance'
  | 'operators' | 'audit' | 'mirror' | 'disputes' | 'tasks' | 'notifications' | 'settings';

export interface AdminNavChild {
  href: string;
  label: string;
  description: string;
  /** 未填写时继承父入口权限；null 表示只要父入口可见便可见。 */
  permission?: AdminPermission | null;
  /** 旧 URL 或未知 tab 回退到这个叶子；每个父入口最多一个。 */
  default?: boolean;
}

export interface AdminNavEntry {
  href: string;
  label: string;
  description: string;
  icon: AdminNavIcon;
  permission: AdminPermission | null;
  /** 供栏目搜索命中，不制造无法准确定位的伪链接。 */
  keywords?: readonly string[];
  children?: AdminNavChild[];
}

export interface AdminNavGroup {id: string; label: string; entries: AdminNavEntry[];}
export interface AdminNavMatch {group: AdminNavGroup; entry: AdminNavEntry; child: AdminNavChild | null;}

const tab = (href: string, label: string, description: string, isDefault = false): AdminNavChild => ({
  href, label, description, ...(isDefault ? {default: true} : {}),
});

export const ADMIN_NAV: AdminNavGroup[] = [
  {id: 'workbench', label: '工作台', entries: [
    {href: '/admin', label: '经营概览', description: '关键指标、待办与系统状态', icon: 'dashboard', permission: null},
    {href: '/admin/analytics', label: '运营分析', description: '用户、内容、AI 用量、充值和退款汇总', icon: 'analytics', permission: 'analytics.read'},
    {href: '/admin/notifications', label: '通知统计', description: '发送量、未读与已读情况', icon: 'notifications', permission: 'notifications.read'},
  ]},
  {id: 'accounts', label: '账户与权益', entries: [
    {href: '/admin/accounts', label: '用户管理', description: '用户列表、资料、会员资产、额度特例与关联记录', icon: 'accounts', permission: 'accounts.read', keywords: ['用户列表', '基本资料', '会员与资产', '额度特例', '记录与关联', '会话', '订单流水']},
    {href: '/admin/memberships', label: '会员方案', description: '月、季、年会员价格、权益与退款规则', icon: 'memberships', permission: 'finance.read'},
    {href: '/admin/compliance', label: '注册合规', description: '年龄确认、服务条款与隐私政策版本', icon: 'compliance', permission: 'compliance.read'},
  ]},
  {id: 'content', label: '内容与社区', entries: [
    {href: '/admin/characters', label: '角色管理', description: '角色状态、标签、内容编辑与管理预览', icon: 'characters', permission: 'characters.read'},
    {href: '/admin/site-content', label: '站点内容', description: '首页、导航、公告、品牌主题的草稿与发布', icon: 'site-content', permission: 'site.content.read', children: [
      tab('/admin/site-content', '首页横幅', '首页主视觉与行动入口', true),
      tab('/admin/site-content?tab=tag', '分类标签', '内容发现与筛选标签'),
      tab('/admin/site-content?tab=badge', '角色徽章', '角色展示徽章'),
      tab('/admin/site-content?tab=section', '首页展示区', '首页内容编排'),
      tab('/admin/site-content?tab=navigation', '导航与页脚', '前台导航与页脚链接'),
      tab('/admin/site-content?tab=page', '页面与公告', '固定页面与运营公告'),
      tab('/admin/site-content?tab=branding', '品牌与主题', '品牌名称、标识和主题色'),
    ]},
    {href: '/admin/moderation', label: '审核中心', description: '角色审核、举报、申诉与禁言', icon: 'moderation', permission: 'moderation.read'},
    {href: '/admin/circles', label: '圈子与成员', description: '圈子内容、公开推荐、成员与加入限制', icon: 'circles', permission: 'community.read'},
    {href: '/admin/community/posts', label: '帖子管理', description: '帖子编辑、置顶、推荐与下架', icon: 'posts', permission: 'community.read'},
    {href: '/admin/community/comments', label: '评论管理', description: '评论查看、隐藏与内容处理', icon: 'comments', permission: 'community.read'},
  ]},
  {id: 'experiences', label: '活动与玩法', entries: [
    {href: '/admin/mirror', label: '他眼中的你', description: '生成结果、玩法配置与效果统计', icon: 'mirror', permission: 'mirror.read', children: [
      tab('/admin/mirror', '结果列表', '查看与管理生成结果', true),
      tab('/admin/mirror?tab=config', '玩法配置', '角色、题目与生成规则'),
      tab('/admin/mirror?tab=stats', '效果统计', '生成成功率与玩法数据'),
    ]},
    {href: '/admin/disputes', label: '评理广场', description: '案例、投票、截止时间与结案结果', icon: 'disputes', permission: 'disputes.read'},
    {href: '/admin/growth', label: '活动奖励', description: '任务、签到、礼物与奖励预算', icon: 'growth', permission: 'growth.read', children: [
      tab('/admin/growth', '任务配置', '成长任务与发放条件', true),
      tab('/admin/growth?tab=checkin', '签到奖励', '连续签到档位'),
      tab('/admin/growth?tab=gifts', '礼物目录', '互动礼物与金币价格'),
    ]},
  ]},
  {id: 'ai', label: 'AI 平台', entries: [
    {href: '/admin/ai/providers', label: 'AI 供应商', description: '连接地址、密钥状态、启停、引用与连通性', icon: 'ai-providers', permission: 'ai.providers.read', keywords: ['供应商引用', '关联模型', '连接检查']},
    {href: '/admin/ai/models', label: '模型服务', description: '模型绑定、默认备用路由、引用、超时与重试', icon: 'ai-models', permission: 'ai.models.read', keywords: ['模型引用', '关联角色', '关联会话', '默认模型', '备用模型']},
    {href: '/admin/ai/costs', label: '价格与成本', description: 'AI 币价、供应商成本与预算熔断', icon: 'ai-costs', permission: 'ai.costs.read', children: [
      tab('/admin/ai/costs', 'AI 币价', '模型收费币价与生效版本', true),
      tab('/admin/ai/costs?tab=analysis', '成本分析', '调用成本、收入与毛利口径'),
      tab('/admin/ai/costs?tab=budget', '预算控制', '任务预算与熔断策略'),
    ]},
  ]},
  {id: 'finance', label: '财务与支付', entries: [
    {href: '/admin/finance', label: '财务工作台', description: '订单、退款、金币套餐与对账', icon: 'finance', permission: 'finance.read', children: [
      tab('/admin/finance', '支付订单', '订单、金币流水与处理详情', true),
      tab('/admin/finance?tab=overview', '经营概览', '充值、退款与费用汇总'),
      tab('/admin/finance?tab=refunds', '退款台账', '退款申请与处理状态'),
      tab('/admin/finance?tab=packages', '金币套餐', '充值套餐与销售状态'),
      tab('/admin/finance?tab=reconcile', '对账中心', '渠道账单、回调与费用核对'),
    ]},
    {href: '/admin/payments/merchants', label: '支付商户', description: '独立管理商户版本、凭据、退款能力与验证', icon: 'merchants', permission: 'payments.merchants.read'},
  ]},
  {id: 'system', label: '系统与安全', entries: [
    {href: '/admin/settings', label: '平台设置', description: '跨业务基础参数、账号运行与提示词', icon: 'settings', permission: 'settings.read', children: [
      tab('/admin/settings?section=chat-input', '聊天与内容', '聊天、社区内容与上传限制', true),
      tab('/admin/settings?tab=billing&section=billing-base', '计费额度', '基础收费、额度与结算口径'),
      tab('/admin/settings?tab=growth&section=growth-grant', '玩法参数', '活动入口、记忆与任务参数'),
      tab('/admin/settings?tab=accounts&section=accounts-login', '账号运行', '注册与登录会话参数'),
      tab('/admin/settings?tab=prompts&section=prompts-templates', '提示词', '玩法与摘要提示词模板'),
    ]},
    {href: '/admin/tasks', label: '后台任务', description: '摘要、结案、过期、核对与清理任务状态', icon: 'tasks', permission: 'tasks.read'},
    {href: '/admin/operations', label: '系统运行', description: '应用状态、维护、证书、备份与日志', icon: 'operations', permission: 'operations.read', children: [
      tab('/admin/operations', '运行状态', '应用、数据库与迁移状态', true),
      tab('/admin/operations?tab=maintenance', '维护与证书', '维护模式和证书检查'),
      tab('/admin/operations?tab=backup', '备份与日志', '备份清单与任务日志'),
    ]},
    {href: '/admin/operators', label: '管理员与角色', description: '管理身份、角色分配与操作权限', icon: 'operators', permission: 'admin.staff.read'},
    {href: '/admin/audit', label: '操作审计', description: '权限变更、操作理由与审计记录', icon: 'audit', permission: 'admin.audit.read'},
  ]},
];

export function canSeeEntry(entry: AdminNavEntry, permissions: readonly AdminPermission[]): boolean {
  return entry.permission === null || permissions.includes(entry.permission);
}

export function canSeeChild(child: AdminNavChild, parent: AdminNavEntry, permissions: readonly AdminPermission[]): boolean {
  const permission = child.permission === undefined ? parent.permission : child.permission;
  return permission === null || permissions.includes(permission);
}

export function visibleGroups(permissions: readonly AdminPermission[]): AdminNavGroup[] {
  return ADMIN_NAV.map(group => ({
    ...group,
    entries: group.entries.filter(entry => canSeeEntry(entry, permissions)).map(entry => ({
      ...entry,
      ...(entry.children ? {children: entry.children.filter(child => canSeeChild(child, entry, permissions))} : {}),
    })),
  })).filter(group => group.entries.length > 0);
}

export function visibleEntries(permissions: readonly AdminPermission[]): AdminNavEntry[] {
  return visibleGroups(permissions).flatMap(group => group.entries);
}

function parseLocation(location: string): URL {return new URL(location, 'https://admin.local');}

/** 父入口拥有完整路径分支；首页只能精确匹配，避免在所有页面同时高亮。 */
export function isEntryActive(location: string, href: string): boolean {
  const current = parseLocation(location).pathname.replace(/\/$/, '') || '/';
  const target = parseLocation(href).pathname.replace(/\/$/, '') || '/';
  return target === '/admin' ? current === target : current === target || current.startsWith(target + '/');
}

function childMatches(location: URL, child: AdminNavChild): boolean {
  const target = parseLocation(child.href);
  if (location.pathname !== target.pathname) return false;
  // 设置小节只是落点，不改变“聊天/计费/玩法/账号/提示词”这个二级栏目身份。
  const identityParams = [...target.searchParams].filter(([key]) => !(target.pathname === '/admin/settings' && key === 'section'));
  if (identityParams.length === 0) return false;
  for (const [key, value] of identityParams) if (location.searchParams.get(key) !== value) return false;
  return true;
}

/** 最长父路径优先；旧 URL（无 tab）和未知 tab 均落到声明的默认叶子。 */
export function findEntry(location: string, permissions: readonly AdminPermission[]): AdminNavMatch | null {
  const parsed = parseLocation(location);
  // 财务页旧版“商户”标签已经迁到独立路由；重定向完成前也不得误标“支付订单”。
  if (parsed.pathname === '/admin/finance' && parsed.searchParams.get('tab') === 'merchants') {
    for (const group of visibleGroups(permissions)) {
      const entry = group.entries.find(item => item.href === '/admin/payments/merchants');
      if (entry) return {group, entry, child: null};
    }
    return null;
  }
  let best: {group: AdminNavGroup; entry: AdminNavEntry} | null = null;
  for (const group of visibleGroups(permissions)) for (const entry of group.entries) {
    if (isEntryActive(parsed.pathname, entry.href) && (!best || entry.href.length > best.entry.href.length)) best = {group, entry};
  }
  if (!best) return null;
  const exactParentPath = parsed.pathname === parseLocation(best.entry.href).pathname;
  const child = exactParentPath && best.entry.children?.length
    ? best.entry.children.find(item => childMatches(parsed, item)) ?? best.entry.children.find(item => item.default) ?? null
    : null;
  return {...best, child};
}

/** 唯一 active 叶子键；有二级栏目时不会同时把父、子标成当前页。 */
export function activeNavHref(location: string, permissions: readonly AdminPermission[]): string | null {
  const match = findEntry(location, permissions);
  return match?.child?.href ?? match?.entry.href ?? null;
}
