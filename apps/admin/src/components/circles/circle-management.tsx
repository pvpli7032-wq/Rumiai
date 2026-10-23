'use client';
import {useCallback, useEffect, useState, type FormEvent} from 'react';
import {Plus, RefreshCw, Search} from 'lucide-react';
import {useAdminAccess} from '../use-admin-access';
import {CircleEditor} from './circle-editor';
import {CircleMembers} from './circle-members';
import type {CircleAction, CircleContent, CircleList, ManagedCircle} from './types';
import {apiFetch} from '@admin/lib/api-client';
import {AdminNotice, AdminPage, AdminPageHeader, AdminPanel} from '../admin-page';
import {Badge} from '@rumiai/ui/badge';
import {Button} from '@rumiai/ui/button';
import {DataTable} from '@rumiai/ui/data-table';
import {EmptyState} from '@rumiai/ui/empty-state';
import {Input} from '@rumiai/ui/input';
import {Select} from '@rumiai/ui/select';

export function CircleManagement() {
  const {sessionActive, permissions, loading, error: accessError} = useAdminAccess();
  const allowed = permissions.includes('community.read'), canEdit = permissions.includes('community.write'), canManageMembers = permissions.includes('community.members.manage');
  const [q, setQ] = useState(''), [query, setQuery] = useState(''), [status, setStatus] = useState('ALL'), [ownership, setOwnership] = useState('ALL'), [featured, setFeatured] = useState('ALL'), [page, setPage] = useState(1), [revision, setRevision] = useState(0);
  const [list, setList] = useState<CircleList | null>(null), [selected, setSelected] = useState<string | null>(null), [detail, setDetail] = useState<ManagedCircle | null>(null), [creating, setCreating] = useState(false);
  const [reading, setReading] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const request = useCallback(<T,>(url: string, signal?: AbortSignal, body?: object, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' = 'GET') => apiFetch<T>(url, {method, credentials: 'same-origin', body, signal, cache: 'no-store'}), [sessionActive]);
  useEffect(() => {setList(null); setSelected(null); setDetail(null); setCreating(false); setError(''); setMessage('');}, [sessionActive]);
  useEffect(() => {
    setList(null); if (!sessionActive || !allowed) return;
    const controller = new AbortController(); setReading(true);
    const params = new URLSearchParams({q: query, status, ownership, featured, page: String(page)});
    void request<CircleList>(`/api/admin/circles?${params}`, controller.signal).then(data => {if (!controller.signal.aborted) setList(data);}).catch(value => {if (!controller.signal.aborted) setError(value.message);}).finally(() => {if (!controller.signal.aborted) setReading(false);});
    return () => controller.abort();
  }, [request, sessionActive, allowed, query, status, ownership, featured, page, revision]);
  useEffect(() => {
    setDetail(null); if (!selected || !allowed) return;
    const controller = new AbortController();
    void request<ManagedCircle>(`/api/admin/circles/${encodeURIComponent(selected)}`, controller.signal).then(data => {if (!controller.signal.aborted) setDetail(data);}).catch(value => {if (!controller.signal.aborted) setError(value.message);});
    return () => controller.abort();
  }, [request, selected, allowed]);
  async function apply(action: CircleAction, reason: string, content?: CircleContent) {
    if (busy || !creating && !detail) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const saved = await request<ManagedCircle>(creating ? '/api/admin/circles' : `/api/admin/circles/${encodeURIComponent(detail!.id)}`, undefined, {action, reason, ...(content ? {content} : {}), ...(detail ? {updatedAt: detail.updatedAt} : {})}, creating ? 'POST' : 'PATCH');
      setCreating(false); setSelected(saved.id); setDetail(saved); setRevision(value => value + 1); setMessage('圈子操作已完成。');
    } catch (value) {
      setError((value as Error).message);
      setRevision(value => value + 1);
    } finally {setBusy(false);}
  }
  function membersChanged() {
    setRevision(value => value + 1);
    if (selected) void request<ManagedCircle>(`/api/admin/circles/${encodeURIComponent(selected)}`).then(data => setDetail(previous => previous && previous.id === data.id ? {...previous, _count: data._count} : previous)).catch(value => setError(value.message));
  }
  function search(event: FormEvent) {event.preventDefault(); setPage(1); setQuery(q); setRevision(value => value + 1); setError('');}
  if (loading) return <AdminPage><AdminNotice tone="loading" title="正在读取社区管理权限…" /></AdminPage>;
  if (!sessionActive || !allowed) return <AdminPage><AdminNotice tone="denied" title={accessError || '当前账号没有社区管理查看权限。'} /></AdminPage>;
  return <AdminPage>
    <AdminPageHeader
      eyebrow="内容与社区"
      title="圈子与成员"
      description="管理站点和用户圈子、前台推荐、公开状态、成员与加入限制。"
      actions={canEdit && <Button leadingIcon={<Plus className="h-4 w-4" />} disabled={busy} onClick={() => {setCreating(true); setSelected(null); setDetail(null); setError(''); setMessage('');}}>新增站点圈子</Button>}
    />
    {error && <AdminNotice tone="error" title={error} className="py-6" />}
    {message && <AdminNotice tone="success" title={message} className="py-6" />}
    <AdminPanel title="筛选检索" description="支持按名称、介绍、标签或圈子编号搜索，并按归属与推荐状态过滤。" badge={list && <Badge>{list.total} 个</Badge>}>
      <form onSubmit={search} className="grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <label className="space-y-1.5 text-sm font-medium text-foreground">搜索圈子
          <Input aria-label="搜索管理圈子" maxLength={100} value={q} onChange={event => setQ(event.target.value)} placeholder="名称、介绍、标签或圈子编号" />
        </label>
        <label className="space-y-1.5 text-sm font-medium text-foreground">圈子状态
          <Select aria-label="管理圈子状态" value={status} onChange={event => {setStatus(event.target.value); setPage(1);}}><option value="ALL">全部状态</option><option value="ACTIVE">公开</option><option value="HIDDEN">隐藏</option></Select>
        </label>
        <label className="space-y-1.5 text-sm font-medium text-foreground">圈子归属
          <Select aria-label="管理圈子归属" value={ownership} onChange={event => {setOwnership(event.target.value); setPage(1);}}><option value="ALL">全部归属</option><option value="SITE">站点圈子</option><option value="USER">用户圈子</option></Select>
        </label>
        <label className="space-y-1.5 text-sm font-medium text-foreground">推荐状态
          <Select aria-label="管理圈子推荐" value={featured} onChange={event => {setFeatured(event.target.value); setPage(1);}}><option value="ALL">全部</option><option value="YES">已推荐</option><option value="NO">未推荐</option></Select>
        </label>
        <div className="flex flex-wrap gap-3 sm:col-span-2 xl:col-span-4">
          <Button type="submit" leadingIcon={<Search className="h-4 w-4" />} disabled={busy || reading}>搜索圈子</Button>
          <Button type="button" variant="outline" leadingIcon={<RefreshCw className="h-4 w-4" />} disabled={busy || reading} onClick={() => setRevision(value => value + 1)}>刷新列表</Button>
        </div>
      </form>
    </AdminPanel>
    {reading && <AdminNotice tone="loading" title="正在查询圈子…" />}
    {list && <DataTable
      rows={list.items}
      getRowId={circle => circle.id}
      empty={<EmptyState title="没有匹配的圈子" description="调整筛选条件后重试。" />}
      columns={[
        {id: 'name', header: '圈子', cell: circle => (
          <span className="block max-w-xs break-words">
            <span className="block font-medium">{circle.name}</span>
            <span className="mt-0.5 block break-all text-xs text-muted-foreground">{circle.id}</span>
            <span className="mt-1 block text-xs text-muted-foreground">{circle.tags ?? '无标签'}</span>
          </span>
        )},
        {id: 'owner', header: '归属', width: '140px', cell: circle => circle.owner?.username ?? '站点'},
        {id: 'status', header: '状态', width: '150px', cell: circle => (
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge variant={circle.status === 'ACTIVE' ? 'success' : 'neutral'}>{circle.status === 'ACTIVE' ? '公开' : '隐藏'}</Badge>
            {circle.isFeatured && <Badge variant="brand">推荐</Badge>}
          </span>
        )},
        {id: 'counts', header: '成员/帖子', width: '120px', cell: circle => <span className="tabular-nums">{circle._count.members} / {circle._count.posts}</span>},
        {id: 'updated', header: '更新时间', width: '180px', cell: circle => <span className="whitespace-nowrap text-xs text-muted-foreground">{new Date(circle.updatedAt).toLocaleString('zh-CN')}</span>},
        {id: 'actions', header: '操作', width: '110px', cell: circle => (
          <Button size="sm" variant="outline" aria-label={`查看圈子 ${circle.name}`} disabled={busy} onClick={() => {setCreating(false); setSelected(circle.id); setError(''); setMessage('');}}>查看详情</Button>
        )},
      ]}
      pagination={{page, pageCount: Math.max(1, Math.ceil(list.total / list.pageSize)), onPageChange: value => setPage(value), summary: `共 ${list.total} 个`}}
    />}
    {(creating || detail) && <CircleEditor key={creating ? 'new-circle' : `${detail!.id}:${detail!.updatedAt}`} circle={creating ? null : detail} canEdit={canEdit} busy={busy} onApply={apply} onRefresh={() => {if (detail) void request<ManagedCircle>(`/api/admin/circles/${encodeURIComponent(detail.id)}`).then(data => {setDetail(data); setError(''); setMessage('详情已重新读取。');}).catch(value => setError(value.message));}} onClose={() => {setCreating(false); setSelected(null); setDetail(null);}} />}
    {detail && !creating && <CircleMembers key={detail.id} circleId={detail.id} sessionActive={sessionActive} canManage={canManageMembers} onChanged={membersChanged} />}
  </AdminPage>;
}
