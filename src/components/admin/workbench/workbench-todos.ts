import type {AdminPermission} from '@/lib/admin/permissions';
import type {TodoItem} from './types';
import {NO_PERMISSION} from './workbench-metrics';

/**
 * 待办队列：今天要处理的三件事，点进去是对应列表。
 * 数量算不出来时给 null 并写明原因，不退回 0。
 */
export interface TodoInput {
  permissions: readonly AdminPermission[];
  characters: unknown;
  reports: unknown;
  refunds: unknown;
}

export function todoItems(input: TodoInput): TodoItem[] {
  const canModerate = input.permissions.includes('moderation.read');
  const canFinance = input.permissions.includes('finance.read');
  const pendingCharacters = Array.isArray(input.characters)
    ? (input.characters as Array<{reviewStatus?: string}>).filter(row => row.reviewStatus === 'PENDING').length
    : null;
  const refunds = Array.isArray(input.refunds)
    ? (input.refunds as Array<{status?: string}>).filter(row => row.status === 'REFUND_PENDING').length
    : null;

  return [
    {
      id: 'characters',
      label: '待审角色',
      count: canModerate ? pendingCharacters : null,
      href: '/admin/moderation',
      description: canModerate ? '申请公开、等待审核的角色。' : NO_PERMISSION,
    },
    {
      id: 'reports',
      label: '未处理举报',
      count: canModerate ? countOf(input.reports) : null,
      href: '/admin/moderation',
      description: canModerate ? '状态仍为待处理的举报。' : NO_PERMISSION,
    },
    {
      id: 'refunds',
      label: '待处理退款',
      count: canFinance ? refunds : null,
      href: '/admin/finance',
      description: canFinance ? '已受理、等待退款结果的订单。' : NO_PERMISSION,
    },
  ];
}

function countOf(payload: unknown): number | null {
  if (Array.isArray(payload)) return payload.length;
  if (payload && typeof payload === 'object') {
    const items = (payload as {items?: unknown}).items;
    if (Array.isArray(items)) return items.length;
  }
  // 接口形状变了也算「算不出来」，不能退回 0。
  return null;
}
