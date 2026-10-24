'use client';
import {useCallback, useEffect, useRef, useState} from 'react';
import {Plus, RefreshCw, Search} from 'lucide-react';
import {useAdminAccess} from '../use-admin-access';
import {CharacterBulkActions} from './character-bulk-actions';
import {CharacterEditor} from './character-editor';
import {CharacterModelAccess} from './character-model-access';
import {statusLabels, type CharacterContent, type CharacterSummary, type ManagedCharacter} from './types';
import {apiFetch} from '@admin/lib/api-client';
import {AdminNotice, AdminPage, AdminPageHeader, AdminPanel} from '../admin-page';
import {Badge} from '@rumiai/ui/badge';
import {Button} from '@rumiai/ui/button';
import {DataTable} from '@admin/components/layout/data-table';
import {EmptyState} from '@rumiai/ui/empty-state';
import {Input} from '@rumiai/ui/input';
import {Select} from '@rumiai/ui/select';
import {DetailDrawer} from '@admin/components/layout/detail-drawer';

export function CharacterManagement() {
  const {sessionActive, permissions, loading: accessLoading, error: accessError} = useAdminAccess();
  const allowed = permissions.includes('characters.read'), canEdit = permissions.includes('characters.write'), canPublish = permissions.includes('characters.publish');
  const [selectedRows, setSelectedRows] = useState<Record<string, boolean>>({});
  const [q, setQ] = useState(''), [query, setQuery] = useState(''), [status, setStatus] = useState('ALL'), [tag, setTag] = useState(''), [creator, setCreator] = useState(''), [page, setPage] = useState(1), [refresh, setRefresh] = useState(0);
  const [list, setList] = useState<{items: CharacterSummary[]; total: number; pageSize: number} | null>(null), [selected, setSelected] = useState<string | null>(null), [detail, setDetail] = useState<ManagedCharacter | null>(null), [creating, setCreating] = useState(false);
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [reading, setReading] = useState(false), [detailLoading, setDetailLoading] = useState(false);
  const [detailDirty, setDetailDirty] = useState(false);
  const busyRef = useRef(false);
  const request = useCallback(<T,>(url: string, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' = 'GET', body?: object, signal?: AbortSignal) => apiFetch<T>(url, {method, credentials: 'same-origin', body, signal, cache: 'no-store'}), [sessionActive]);
  useEffect(() => {setList(null); setDetail(null); setSelected(null); setCreating(false);}, [sessionActive]);
  useEffect(() => {
    setList(null); setSelectedRows({}); if (!sessionActive || !allowed) return;
    const controller = new AbortController(); setReading(true);
    const params = new URLSearchParams({q: query, status, tag, creatorId: creator, page: String(page)});
    void request<{items: CharacterSummary[]; total: number; pageSize: number}>(`/api/admin/characters?${params}`, 'GET', undefined, controller.signal).then(data => {if (!controller.signal.aborted) setList(data);}).catch(value => {if (!controller.signal.aborted) setError(value.message);}).finally(() => {if (!controller.signal.aborted) setReading(false);});
    return () => controller.abort();
  }, [sessionActive, allowed, request, query, status, tag, creator, page, refresh]);
  useEffect(() => {
    setDetail(current => current?.id === selected ? current : null); if (!selected || !allowed) return;
    const controller = new AbortController(); setDetailLoading(true);
    void request<ManagedCharacter>(`/api/admin/characters/${encodeURIComponent(selected)}`, 'GET', undefined, controller.signal).then(data => {if (!controller.signal.aborted) setDetail(data);}).catch(value => {if (!controller.signal.aborted) setError(value.message);}).finally(() => {if (!controller.signal.aborted) setDetailLoading(false);});
    return () => controller.abort();
  }, [selected, allowed, request, refresh]);
  async function save(content: CharacterContent, reason: string) {
    if (busyRef.current) return false; busyRef.current = true; setBusy(true); setError(''); setMessage('');
    try {
      const id = detail?.id;
      const result = await request<{id: string}>(id ? `/api/admin/characters/${encodeURIComponent(id)}` : '/api/admin/characters', id ? 'PUT' : 'POST', {content, reason, ...(id ? {updatedAt: detail!.updatedAt} : {})});
      setCreating(false); setSelected(result.id); setRefresh(value => value + 1); setMessage('角色内容已保存，公开状态由发布流程管理。'); return true;
    } catch (value) {setError((value as Error).message); return false;} finally {busyRef.current = false; setBusy(false);}
  }
  async function publish(action: 'PUBLISH' | 'UNPUBLISH', reason: string) {
    if (busyRef.current || !detail) return false; busyRef.current = true; setBusy(true); setError(''); setMessage('');
    try {await request(`/api/admin/characters/${encodeURIComponent(detail.id)}/publication`, 'POST', {action, reason, updatedAt: detail.updatedAt}); setRefresh(value => value + 1); setMessage(action === 'PUBLISH' ? '角色已公开，前台可见性已更新。' : '角色已下架，前台可见性已更新。'); return true;}
    catch (value) {setError((value as Error).message); return false;} finally {busyRef.current = false; setBusy(false);}
  }
  async function removeDraft(reason: string) {
    if (busyRef.current || !detail) return false; busyRef.current = true; setBusy(true); setError(''); setMessage('');
    try {await request(`/api/admin/characters/${encodeURIComponent(detail.id)}`, 'DELETE', {updatedAt: detail.updatedAt, reason}); setDetailDirty(false); setCreating(false); setSelected(null); setDetail(null); setRefresh(value => value + 1); setMessage('未使用的站点角色草稿已删除。'); return true;}
    catch (value) {setError((value as Error).message); return false;} finally {busyRef.current = false; setBusy(false);}
  }
  async function bulkPublish(action: 'PUBLISH' | 'UNPUBLISH', reason: string, items: CharacterSummary[]) {
    if (busyRef.current) return false; busyRef.current = true; setBusy(true); setError(''); setMessage('');
    try {await request('/api/admin/characters/publication', 'POST', {action, reason, items: items.map(character => ({id: character.id, updatedAt: character.updatedAt}))}); setRefresh(value => value + 1); setMessage('批量角色操作已完成。'); return true;}
    catch (value) {setError((value as Error).message); return false;} finally {busyRef.current = false; setBusy(false);}
  }
  const closeDetail = useCallback(() => {
    if (busy) return;
    if (detailDirty && !window.confirm('当前角色详情有未保存修改，确定关闭并放弃吗？')) return;
    setDetailDirty(false); setCreating(false); setSelected(null); setDetail(null);
  }, [busy, detailDirty]);
  const selectCharacter = useCallback((id: string) => {
    if (busy) return;
    if (detailDirty && !window.confirm('当前角色详情有未保存修改，切换对象会放弃修改，继续吗？')) return;
    setDetailDirty(false); setCreating(false); setDetail(null); setSelected(id); setError(''); setMessage('');
  }, [busy, detailDirty]);
  if (accessLoading) return <AdminPage><AdminNotice tone="loading" title="正在读取角色管理权限…" /></AdminPage>;
  if (!sessionActive || !allowed) return <AdminPage><AdminNotice tone="denied" title={accessError || '当前账号没有角色管理查看权限。'} /></AdminPage>;
  return <AdminPage>
    <AdminPageHeader
      eyebrow="内容与社区"
      title="角色管理"
      description="按状态、标签和作者管理角色，编辑与发布分别授权。后台新增角色及其素材归站点所有，个人作者的角色仍保留原作者归属。"
      actions={canEdit && <Button leadingIcon={<Plus className="h-4 w-4" />} disabled={busy} onClick={() => {setSelected(null); setDetail(null); setCreating(true); setError(''); setMessage('');}}>新增角色</Button>}
    />
    {error && <AdminNotice tone="error" title={error} className="py-6" />}
    {message && <AdminNotice tone="success" title={message} className="py-6" />}
    <AdminPanel className="border-border bg-card shadow-sm" title="筛选检索" description="支持按名称、简介、标签、作者编号与审核状态组合筛选。" badge={list && <Badge>{list.total} 个</Badge>}>
      <form className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" onSubmit={event => {event.preventDefault(); setQuery(q); setPage(1); setRefresh(value => value + 1); setError('');}}>
        <label className="space-y-1.5 text-sm font-medium text-foreground">搜索角色
          <Input maxLength={100} value={q} onChange={event => setQ(event.target.value)} placeholder="名称、简介或角色编号" />
        </label>
        <label className="space-y-1.5 text-sm font-medium text-foreground">审核状态
          <Select aria-label="审核状态" value={status} onChange={event => {setStatus(event.target.value); setPage(1);}}><option value="ALL">全部状态</option>{Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select>
        </label>
        <label className="space-y-1.5 text-sm font-medium text-foreground">标签筛选
          <Input maxLength={50} value={tag} onChange={event => {setTag(event.target.value); setPage(1);}} />
        </label>
        <label className="space-y-1.5 text-sm font-medium text-foreground">作者编号
          <Input maxLength={100} value={creator} onChange={event => {setCreator(event.target.value); setPage(1);}} />
        </label>
        <div className="flex flex-wrap gap-3 sm:col-span-2 xl:col-span-4">
          <Button type="submit" leadingIcon={<Search className="h-4 w-4" />} disabled={reading}>搜索角色</Button>
          <Button type="button" variant="outline" leadingIcon={<RefreshCw className="h-4 w-4" />} disabled={reading} onClick={() => setRefresh(value => value + 1)}>刷新列表</Button>
        </div>
      </form>
    </AdminPanel>
    {canPublish && list && <CharacterBulkActions items={list.items.filter(character => selectedRows[character.id])} busy={busy} onApply={bulkPublish} />}
    {reading && <AdminNotice tone="loading" title="正在查询角色…" />}    {list && <DataTable
      rows={list.items}
      getRowId={character => character.id}
      empty={<EmptyState title="没有匹配的角色" description="调整筛选条件后重试。" />}
      columns={[
        ...(canPublish ? [{id: 'select', header: '选择', width: '64px', cell: (character: CharacterSummary) => (
          <input aria-label={`选择角色 ${character.name}`} type="checkbox" className="h-4 w-4 rounded border-border accent-brand" disabled={busy || character.reviewStatus === 'DELETED'} checked={!!selectedRows[character.id]} onChange={event => setSelectedRows(previous => ({...previous, [character.id]: event.target.checked}))} />
        )}] : []),
        {id: 'name', header: '角色', cell: character => (
          <span className="block max-w-xs break-words">
            <span className="block font-medium">{character.name}</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">{character.tagline}</span>
            <span className="mt-1 block break-all text-xs text-muted-foreground">{character.id}</span>
          </span>
        )},
        {id: 'creator', header: '归属作者', width: '140px', cell: character => character.creator?.username ?? '系统'},
        {id: 'status', header: '状态', width: '150px', cell: character => (
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge variant={character.reviewStatus === 'APPROVED' ? 'success' : character.reviewStatus === 'DELETED' ? 'danger' : 'warning'}>{statusLabels[character.reviewStatus]}</Badge>
            <Badge variant={character.isPublic ? 'brand' : 'neutral'}>{character.isPublic ? '公开' : '不公开'}</Badge>
          </span>
        )},
        {id: 'tags', header: '标签', width: '180px', cell: character => <span className="block max-w-48 break-words text-xs text-muted-foreground">{character.tags ?? '无'}</span>},
        {id: 'updated', header: '更新时间', width: '180px', cell: character => <span className="whitespace-nowrap text-xs text-muted-foreground">{new Date(character.updatedAt).toLocaleString('zh-CN')}</span>},
        {id: 'actions', header: '操作', width: '110px', cell: character => (
          // 一列里会有多个同名按钮，带上角色名才能让读屏和验收脚本区分。
          <Button size="sm" variant="outline" aria-label={`查看角色 ${character.name}`} disabled={busy} onClick={() => selectCharacter(character.id)}>查看详情</Button>
        )},
      ]}
      pagination={{page, pageCount: Math.max(1, Math.ceil(list.total / list.pageSize)), onPageChange: value => setPage(value), summary: `共 ${list.total} 个`}}
    />}
    <DetailDrawer open={Boolean(creating || selected || detail)} onClose={closeDetail} size="xl" title={creating ? '新增角色' : detail ? `角色详情 · ${detail.name}` : '角色详情'} description={detail ? '编辑、素材、模型权限与发布操作集中在此处。' : '正在读取角色详情…'}>
      {message && <AdminNotice tone="success" title={message} className="mb-4 py-3" />}
      {detailLoading && <AdminNotice tone="loading" title="正在读取角色详情…" />}
      {selected && !detail && !detailLoading && <AdminNotice tone="error" title={error || '角色详情读取失败。'} action={<Button variant="outline" onClick={() => setRefresh(value => value + 1)}>重新读取</Button>} />}
      {(creating || detail) && <CharacterEditor key={creating ? 'new' : `${detail!.id}:${detail!.updatedAt}`} character={creating ? null : detail} canEdit={canEdit} canPublish={canPublish} busy={busy} onSave={save} onPublish={publish} onDelete={removeDraft} onClose={closeDetail} onDirtyChange={setDetailDirty} error={error} />}
      {detail&&!creating&&<CharacterModelAccess key={detail.id} characterId={detail.id} deleted={detail.reviewStatus==='DELETED'}/>}
    </DetailDrawer>
  </AdminPage>;
}
