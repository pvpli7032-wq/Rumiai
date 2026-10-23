'use client';

import { RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { BackupInventoryItem } from '@rumiai/contracts/admin/operations';
import { AdminNotice, AdminPanel } from '../admin-page';
import { Badge } from '@rumiai/ui/badge';
import { Button } from '@rumiai/ui/button';
import { DataTable, type DataTableColumn } from '@rumiai/ui/data-table';

type Catalog = { items: BackupInventoryItem[]; activeRestore: BackupInventoryItem | null; page: number; pageSize: number; total: number };
const kinds: Record<string, string> = { DATABASE: '数据库文件', STATE_BACKUP: '联合备份', STATE_RESTORE: '隔离恢复' };
const checks: Record<string, string> = { NOT_RECORDED: '无校验记录', RECORDED_AT_OPERATION: '操作时已校验', INCOMPLETE: '文件不完整', INVALID_METADATA: '清单异常' };
const reasons: Record<string, string> = { MANIFEST_OR_DATABASE_MISSING: '缺少数据库或清单', DATA_FILES_INCOMPLETE: '数据文件与清单不符', METADATA_INVALID: '清单损坏或恢复记录不匹配', METADATA_TOO_LARGE: '清单超过 8 MiB，请使用 CLI 检查', EMPTY_DATABASE: '数据库文件为空' };
const time = (value: string) => new Date(value).toLocaleString('zh-CN');

function bytes(value: number | null) {
  if (value === null) return '—';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(value)} ${units[unit]}`;
}

const columns: DataTableColumn<BackupInventoryItem>[] = [
  { id: 'kind', header: '类型', width: '140px', cell: item => <span className="whitespace-nowrap">{kinds[item.kind] ?? item.kind}</span> },
  { id: 'recordedAt', header: '记录时间', width: '200px', cell: item => <span className="whitespace-nowrap text-xs">{time(item.recordedAt)}</span> },
  { id: 'database', header: '数据库体积', width: '140px', cell: item => <span className="tabular-nums">{bytes(item.databaseBytes)}</span> },
  { id: 'uploads', header: '上传文件 / 体积', width: '160px', cell: item => <span className="tabular-nums">{item.uploadCount ?? '—'} / {bytes(item.uploadBytes)}</span> },
  { id: 'references', header: '引用数', width: '100px', cell: item => <span className="tabular-nums">{item.referenceCount ?? '—'}</span> },
  { id: 'verification', header: '校验记录', cell: item => (
    <div className="min-w-0">
      <Badge variant={item.verification === 'RECORDED_AT_OPERATION' ? 'success' : ['INCOMPLETE', 'INVALID_METADATA'].includes(item.verification) ? 'warning' : 'neutral'}>
        {checks[item.verification] ?? item.verification}
      </Badge>
      {item.reasonCode && <p className="mt-1 text-xs text-muted-foreground">{reasons[item.reasonCode] ?? '记录暂不可读'}</p>}
    </div>
  ) },
];

export function BackupCatalog({ sessionActive }: { sessionActive: boolean }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null), [page, setPage] = useState(1), [revision, setRevision] = useState(0), [loading, setLoading] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController(); setCatalog(null); setError(''); setLoading(true);
    void fetch(`/api/admin/operations/backups?page=${page}`, {credentials: 'include', cache: 'no-store', signal: controller.signal }).then(async response => { const data = await response.json(); if (!response.ok) throw Error(data.error ?? '备份记录读取失败。'); if (!controller.signal.aborted) setCatalog(data); }).catch(value => { if (!controller.signal.aborted) setError(value.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [sessionActive, page, revision]);

  return (
    <AdminPanel
      title="备份与隔离恢复记录"
      description="按本机文件修改时间分页展示，只读取清单元数据。校验栏是操作完成时的记录；当前完整性须通过 CLI 重新核验，服务切换及完整业务回滚另行验收。"
      actions={<Button variant="outline" size="sm" leadingIcon={<RefreshCw className="h-4 w-4" />} disabled={loading} onClick={() => setRevision(value => value + 1)}>刷新备份记录</Button>}
    >
      <div className="space-y-4">
        {loading && <AdminNotice tone="loading" title="正在读取备份记录…" />}
        {error && <AdminNotice tone="error" title={error} />}
        {catalog?.activeRestore && (
          <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-4 text-sm">
            <p className="font-medium">当前数据库目录中的恢复记录</p>
            <p className="text-muted-foreground">{checks[catalog.activeRestore.verification]}{catalog.activeRestore.verification === 'RECORDED_AT_OPERATION' && (' · ' + time(catalog.activeRestore.recordedAt))}</p>
            <p className="text-xs text-muted-foreground">{catalog.activeRestore.verification === 'RECORDED_AT_OPERATION' ? '这是当时隔离复制与校验的记录，后续业务写入不改变该历史结果。' : '恢复记录不完整或不可读，请由运维人员重新核查。'}</p>
          </div>
        )}
        {catalog && (
          <DataTable
            columns={columns}
            rows={catalog.items}
            getRowId={item => item.id}
            rowAttributes={item => ({ 'data-backup-id': item.id })}
            loading={loading && !catalog.items.length}
            empty="本机尚无备份候选记录。"
            pagination={{
              page: catalog.page,
              pageCount: Math.max(1, Math.ceil(catalog.total / catalog.pageSize)),
              onPageChange: setPage,
              summary: `共 ${catalog.total} 条 · 第 ${catalog.page} 页`,
            }}
          />
        )}
      </div>
    </AdminPanel>
  );
}
