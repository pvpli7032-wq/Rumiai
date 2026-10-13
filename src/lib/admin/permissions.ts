export const PERMISSIONS = {
  'admin.staff.read': '查看管理人员与角色',
  'admin.staff.manage': '分配和停用管理身份',
  'admin.roles.manage': '编辑自定义角色',
  'admin.audit.read': '查看管理操作审计',
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
];
