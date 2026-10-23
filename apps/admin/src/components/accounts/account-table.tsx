import { Eye } from 'lucide-react';
import { DataTable, type DataTableColumn, type DataTablePagination } from '@rumiai/ui/data-table';
import { Badge } from '@rumiai/ui/badge';
import { Button } from '@rumiai/ui/button';
import { accountState, formatTime, type ManagedAccount } from './types';

const columns = (selected: string | null, onSelect: (id: string) => void): DataTableColumn<ManagedAccount>[] => [
  { id: 'user', header: '用户', width: '280px', cell: user => (
    <div className="min-w-0">
      <p className="font-medium text-foreground">{user.displayName || user.username}</p>
      <p className="text-xs text-muted-foreground">@{user.username}</p>
      <p className="text-xs text-muted-foreground">{user.email}</p>
    </div>
  ) },
  { id: 'state', header: '账号状态', width: '120px', cell: user => (
    <Badge variant={user.deletedAt ? 'neutral' : user.suspendedAt ? 'danger' : 'success'}>{accountState(user)}</Badge>
  ) },
  { id: 'community', header: '社区权限', width: '120px', cell: user => (
    <Badge variant={user.communityBannedAt ? 'warning' : 'outline'}>{user.communityBannedAt ? '已禁言' : '可发言'}</Badge>
  ) },
  { id: 'coins', header: '金币余额', width: '120px', cell: user => <span className="tabular-nums">{user.coins}</span> },
  { id: 'time', header: '注册 / 最近活动', width: '220px', cell: user => (
    <div className="whitespace-nowrap">
      <p className="text-xs">{formatTime(user.createdAt)}</p>
      <p className="mt-1 text-xs text-muted-foreground">{formatTime(user.lastActiveAt)}</p>
    </div>
  ) },
  { id: 'actions', header: '操作', align: 'right', width: '120px', cell: user => (
    <Button variant="outline" size="sm" leadingIcon={<Eye className="h-3.5 w-3.5" />} aria-label={`查看用户 ${user.username}`} onClick={() => onSelect(user.id)}>查看详情</Button>
  ) },
];

export function AccountTable({ items, selected, onSelect, loading, pagination }: { items: ManagedAccount[]; selected: string | null; onSelect: (id: string) => void; loading?: boolean; pagination?: DataTablePagination }) {
  return (
    <DataTable
      columns={columns(selected, onSelect)}
      rows={items}
      getRowId={user => user.id}
      rowClassName={user => selected === user.id ? 'bg-brand-soft' : undefined}
      loading={loading}
      loadingRows={8}
      empty="没有匹配的用户，请调整筛选条件或换一个关键词。"
      pagination={pagination}
    />
  );
}
