'use client';

import { Search } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { memberActionLabels, type ManagedCircleMember, type MemberAction, type MemberList } from './types';
import { apiFetch } from '@/lib/api-client';
import { AdminNotice, AdminPanel, AdminToolbar } from '../admin-page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

export function CircleMembers({ circleId, sessionActive, canManage, onChanged }: { circleId: string; sessionActive: boolean; canManage: boolean; onChanged: () => void }) {
  const [q, setQ] = useState(''), [query, setQuery] = useState(''), [status, setStatus] = useState('MEMBER'), [page, setPage] = useState(1), [refresh, setRefresh] = useState(0);
  const [list, setList] = useState<MemberList | null>(null), [reading, setReading] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [selected, setSelected] = useState<{ member: ManagedCircleMember; action: MemberAction } | null>(null), [reason, setReason] = useState('');
  const request = useCallback(<T,>(url: string, signal?: AbortSignal, body?: object) => apiFetch<T>(url, { method: body ? 'PATCH' : 'GET', credentials: 'same-origin', body, signal, cache: 'no-store' }), [sessionActive]);
  useEffect(() => { setSelected(null); setReason(''); setError(''); setMessage(''); }, [sessionActive, circleId, status]);
  useEffect(() => {
    const controller = new AbortController(); setList(null); setReading(true);
    const params = new URLSearchParams({ q: query, status, page: String(page) });
    void request<MemberList>(`/api/admin/circles/${encodeURIComponent(circleId)}/members?${params}`, controller.signal).then(data => { if (!controller.signal.aborted) setList(data); }).catch(value => { if (!controller.signal.aborted) setError(value.message); }).finally(() => { if (!controller.signal.aborted) setReading(false); });
    return () => controller.abort();
  }, [request, circleId, query, status, page, refresh]);

  function search(event: FormEvent) { event.preventDefault(); setError(''); setPage(1); setQuery(q); setRefresh(value => value + 1); }

  async function apply() {
    if (!selected || busy || !reason.trim()) return;
    setBusy(true); setError(''); setMessage('');
    try {
      await request(`/api/admin/circles/${encodeURIComponent(circleId)}/members/${encodeURIComponent(selected.member.userId)}`, undefined, { action: selected.action, updatedAt: selected.member.updatedAt, reason });
      setMessage(`${memberActionLabels[selected.action]}已完成。`); setSelected(null); setReason(''); onChanged();
    } catch (value) { setError((value as Error).message); } finally { setBusy(false); setRefresh(value => value + 1); }
  }

  const actionColumns: DataTableColumn<ManagedCircleMember>[] = canManage
    ? [{
      id: 'actions',
      header: '操作',
      align: 'right',
      width: '200px',
      cell: member => (
        <div className="flex flex-wrap justify-end gap-2">
          {(status === 'BLOCKED' ? ['UNBLOCK'] : ['REMOVE', 'BLOCK']).map(action => (
            <Button
              key={action}
              variant={action === 'REMOVE' ? 'danger' : 'outline'}
              size="sm"
              disabled={busy || !!member.user.deletedAt}
              aria-label={`${memberActionLabels[action as MemberAction]} ${member.user.username}`}
              onClick={() => { setSelected({ member, action: action as MemberAction }); setReason(''); setError(''); setMessage(''); }}
            >
              {memberActionLabels[action as MemberAction]}
            </Button>
          ))}
        </div>
      ),
    }]
    : [];

  const columns: DataTableColumn<ManagedCircleMember>[] = [
    { id: 'user', header: '用户', width: '260px', cell: member => (
      <div className="min-w-0">
        <p className="font-medium">{member.user.displayName || member.user.username}</p>
        <p className="mt-1 break-all text-xs text-muted-foreground">{member.userId}</p>
      </div>
    ) },
    { id: 'state', header: '账号状态', width: '120px', cell: member => (
      <Badge variant={member.user.deletedAt ? 'neutral' : member.user.suspendedAt ? 'danger' : 'success'}>{member.user.deletedAt ? '已注销' : member.user.suspendedAt ? '已停用' : '正常'}</Badge>
    ) },
    { id: 'joined', header: '加入 / 限制时间', width: '200px', cell: member => <span className="whitespace-nowrap text-xs">{new Date(member.createdAt).toLocaleString('zh-CN')}</span> },
    { id: 'reason', header: '限制理由', cell: member => <span className="whitespace-pre-wrap break-words text-xs text-muted-foreground">{member.reason ?? '无'}</span> },
    ...actionColumns,
  ];

  return (
    <>
      <AdminPanel
        title="成员与加入限制"
        description="移除成员后仍可自行重新订阅；限制加入后必须由运营解除，解除不会自动替用户加入。"
        badge={list ? <Badge variant="outline">{list.total} 条</Badge> : undefined}
      >
        <div className="space-y-4">
          <form onSubmit={search}>
            <AdminToolbar>
              <label className="min-w-64 flex-1 space-y-1">
                <span className="text-xs font-medium text-muted-foreground">搜索成员</span>
                <Input aria-label="搜索圈子成员" maxLength={100} value={q} onChange={event => setQ(event.target.value)} placeholder="用户名、昵称或用户编号" />
              </label>
              <label className="w-44 space-y-1">
                <span className="text-xs font-medium text-muted-foreground">成员状态</span>
                <Select aria-label="圈子成员状态" value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}>
                  <option value="MEMBER">已订阅成员</option><option value="BLOCKED">限制加入</option>
                </Select>
              </label>
              <Button type="submit" size="sm" variant="outline" leadingIcon={<Search className="h-4 w-4" />} disabled={busy || reading}>搜索成员</Button>
            </AdminToolbar>
          </form>
          {error && <AdminNotice tone="error" title={error} />}
          {message && <AdminNotice tone="success" title={message} />}
          <DataTable
            columns={columns}
            rows={list?.items ?? []}
            getRowId={member => member.userId}
            loading={reading}
            loadingRows={5}
            empty="没有匹配的成员。"
            pagination={list ? { page, pageCount: Math.max(1, Math.ceil(list.total / list.pageSize)), onPageChange: setPage, summary: `共 ${list.total} 条 · 第 ${page} 页` } : undefined}
          />
        </div>
      </AdminPanel>
      <Dialog
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? memberActionLabels[selected.action] : ''}
        description={selected ? `对象：${selected.member.user.username}（${selected.member.userId}）` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setSelected(null)}>取消处置</Button>
            <Button variant="danger" loading={busy} disabled={busy || !reason.trim()} onClick={() => void apply()}>确认{memberActionLabels[selected?.action ?? 'REMOVE']}</Button>
          </>
        }
      >
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">成员处置理由</span>
          <Textarea aria-label="成员处置理由" rows={3} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} />
        </label>
      </Dialog>
    </>
  );
}
