import type {AdminPermission} from './permissions';

/**
 * The single source of truth for administration navigation.
 *
 * The shell, the workbench and any access helper read this list instead of
 * keeping their own copy of the "permission -> entry" mapping. Pure data plus
 * pure helpers: no server imports, so client components can use it directly.
 */
export type AdminNavIcon =
  | 'dashboard'
  | 'characters'
  | 'moderation'
  | 'circles'
  | 'posts'
  | 'comments'
  | 'accounts'
  | 'analytics'
  | 'growth'
  | 'site-content'
  | 'finance'
  | 'merchants'
  | 'ai-providers'
  | 'ai-models'
  | 'ai-costs'
  | 'operations'
  | 'compliance'
  | 'operators'
  | 'audit';

export interface AdminNavEntry {
  href: string;
  label: string;
  description: string;
  icon: AdminNavIcon;
  /** `null` means "visible to anyone who can reach the console at all". */
  permission: AdminPermission | null;
}

export interface AdminNavGroup {
  id: string;
  label: string;
  entries: AdminNavEntry[];
}

export const ADMIN_NAV: AdminNavGroup[] = [
  {
    id: 'workbench',
    label: '工作台',
    entries: [
      {href: '/admin', label: '概览', description: '关键指标与待办', icon: 'dashboard', permission: null},
    ],
  },
  {
    id: 'content',
    label: '内容与社区',
    entries: [
      {href: '/admin/characters', label: '角色管理', description: '全部状态、标签筛选、内容编辑与管理预览', icon: 'characters', permission: 'characters.read'},
      {href: '/admin/moderation', label: '审核中心', description: '角色审核、举报、申诉与禁言', icon: 'moderation', permission: 'moderation.read'},
      {href: '/admin/circles', label: '圈子与成员', description: '圈子内容、公开与推荐、成员及加入限制', icon: 'circles', permission: 'community.read'},
      {href: '/admin/community/posts', label: '帖子管理', description: '帖子编辑、置顶、推荐与下架', icon: 'posts', permission: 'community.read'},
      {href: '/admin/community/comments', label: '评论管理', description: '评论查看、隐藏与处理', icon: 'comments', permission: 'community.read'},
    ],
  },
  {
    id: 'users',
    label: '用户与客服',
    entries: [
      {href: '/admin/accounts', label: '用户管理', description: '用户查询、账号停用、社区禁言及关联记录', icon: 'accounts', permission: 'accounts.read'},
    ],
  },
  {
    id: 'growth',
    label: '增长与运营',
    entries: [
      {href: '/admin/analytics', label: '运营分析', description: '真实用户、内容、AI 用量、充值和退款汇总', icon: 'analytics', permission: 'analytics.read'},
      {href: '/admin/growth', label: '任务与奖励', description: '任务条件、周期、金币奖励与每日签到配置', icon: 'growth', permission: 'growth.read'},
      {href: '/admin/site-content', label: '站点内容', description: '横幅、分类、徽章与首页展示区的草稿和发布', icon: 'site-content', permission: 'site.content.read'},
    ],
  },
  {
    id: 'finance',
    label: '财务与支付',
    entries: [
      {href: '/admin/finance', label: '订单与退款', description: '充值套餐、订单、退款、对账与 AI 成本', icon: 'finance', permission: 'finance.read'},
      {href: '/admin/payments/merchants', label: '支付商户', description: '商户配置版本、凭据保护、退款开关与验证', icon: 'merchants', permission: 'payments.merchants.read'},
    ],
  },
  {
    id: 'ai',
    label: 'AI 与成本',
    entries: [
      {href: '/admin/ai/providers', label: 'AI 供应商', description: '连接地址、密钥状态、启停与连通性检查', icon: 'ai-providers', permission: 'ai.providers.read'},
      {href: '/admin/ai/models', label: '模型与路由', description: '模型绑定、默认与备用路由、超时和重试', icon: 'ai-models', permission: 'ai.models.read'},
      {href: '/admin/ai/costs', label: '成本与预算', description: '日预算、成本熔断、未知费用与运营告警', icon: 'ai-costs', permission: 'ai.costs.read'},
    ],
  },
  {
    id: 'system',
    label: '系统与安全',
    entries: [
      {href: '/admin/operations', label: '系统与运维', description: '应用进程、迁移、备份清单与维护开关', icon: 'operations', permission: 'operations.read'},
      {href: '/admin/compliance', label: '注册合规', description: '年龄确认要求、服务条款与隐私政策版本', icon: 'compliance', permission: 'compliance.read'},
      {href: '/admin/operators', label: '管理员与角色', description: '管理身份、角色分配与操作权限', icon: 'operators', permission: 'admin.staff.read'},
      {href: '/admin/audit', label: '操作审计', description: '权限变更、操作理由与审计记录', icon: 'audit', permission: 'admin.audit.read'},
    ],
  },
];

export function canSeeEntry(entry: AdminNavEntry, permissions: readonly AdminPermission[]): boolean {
  return entry.permission === null || permissions.includes(entry.permission);
}

/** Groups with every entry the caller cannot see removed; empty groups disappear. */
export function visibleGroups(permissions: readonly AdminPermission[]): AdminNavGroup[] {
  return ADMIN_NAV
    .map(group => ({...group, entries: group.entries.filter(entry => canSeeEntry(entry, permissions))}))
    .filter(group => group.entries.length > 0);
}

export function visibleEntries(permissions: readonly AdminPermission[]): AdminNavEntry[] {
  return visibleGroups(permissions).flatMap(group => group.entries);
}

export function hasAnyAdminEntry(permissions: readonly AdminPermission[]): boolean {
  return visibleEntries(permissions).some(entry => entry.permission !== null);
}

/** Longest matching href wins, so /admin/community/posts beats /admin. */
export function findEntry(pathname: string, permissions: readonly AdminPermission[]): {group: AdminNavGroup; entry: AdminNavEntry} | null {
  let best: {group: AdminNavGroup; entry: AdminNavEntry} | null = null;
  for (const group of visibleGroups(permissions)) {
    for (const entry of group.entries) {
      const matches = pathname === entry.href || pathname.startsWith(entry.href + '/');
      if (matches && (!best || entry.href.length > best.entry.href.length)) best = {group, entry};
    }
  }
  return best;
}
