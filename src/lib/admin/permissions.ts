export const PERMISSIONS = {
  'admin.staff.read': '查看管理人员与角色',
  'admin.staff.manage': '分配和停用管理身份',
  'admin.roles.manage': '编辑自定义角色',
  'admin.audit.read': '查看管理操作审计',
  'accounts.read': '查看用户资料与关联记录',
  'accounts.manage': '停用和恢复网站账号',
  'accounts.sessions.revoke': '撤销用户登录会话',
  'accounts.community.manage': '管理用户社区禁言',
  'characters.read': '查看全部角色与管理预览',
  'characters.write': '创建和编辑角色内容',
  'characters.publish': '发布和下架角色',
  'moderation.read': '查看审核与举报队列',
  'moderation.write': '处理审核、举报与申诉',
  'finance.read': '查看财务、套餐与订单',
  'finance.packages.write': '管理充值套餐及活动',
  'finance.refunds.execute': '执行和核对退款',
} as const;
export type AdminPermission = keyof typeof PERMISSIONS;
export const OWNER_ONLY: AdminPermission[] = ['admin.staff.manage', 'admin.roles.manage'];
export const SYSTEM_ROLES = [
  {code: 'OWNER', name: '所有者', permissions: Object.keys(PERMISSIONS) as AdminPermission[]},
  {code: 'MODERATOR', name: '审核管理员', permissions: ['moderation.read', 'moderation.write'] as AdminPermission[]},
  {code: 'FINANCE_VIEWER', name: '财务查看员', permissions: ['finance.read'] as AdminPermission[]},
  {code: 'FINANCE_MANAGER', name: '财务管理员', permissions: ['finance.read', 'finance.packages.write', 'finance.refunds.execute'] as AdminPermission[]},
  {code: 'AUDITOR', name: '管理审计员', permissions: ['admin.staff.read', 'admin.audit.read'] as AdminPermission[]},
  {code: 'SUPPORT_AGENT', name: '用户客服', permissions: ['accounts.read', 'accounts.community.manage'] as AdminPermission[]},
  {code: 'CHARACTER_MANAGER', name: '角色管理员', permissions: ['characters.read', 'characters.write', 'characters.publish'] as AdminPermission[]},
];
