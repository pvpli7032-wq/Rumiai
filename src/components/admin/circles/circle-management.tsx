'use client';
import {useCallback, useEffect, useState, type FormEvent} from 'react';
import {useAdminAccess} from '../use-admin-access';
import {CircleEditor} from './circle-editor';
import {CircleMembers} from './circle-members';
import type {CircleAction, CircleContent, CircleList, ManagedCircle} from './types';
import {apiFetch} from '@/lib/api-client';

export function CircleManagement() {
  const {token, permissions, loading, error: accessError} = useAdminAccess();
  const allowed = permissions.includes('community.read'), canEdit = permissions.includes('community.write'), canManageMembers = permissions.includes('community.members.manage');
  const [q, setQ] = useState(''), [query, setQuery] = useState(''), [status, setStatus] = useState('ALL'), [ownership, setOwnership] = useState('ALL'), [featured, setFeatured] = useState('ALL'), [page, setPage] = useState(1), [revision, setRevision] = useState(0);
  const [list, setList] = useState<CircleList | null>(null), [selected, setSelected] = useState<string | null>(null), [detail, setDetail] = useState<ManagedCircle | null>(null), [creating, setCreating] = useState(false);
  const [reading, setReading] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const request = useCallback(<T,>(url: string, signal?: AbortSignal, body?: object, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' = 'GET') => apiFetch<T>(url, {method, token, body, signal, cache: 'no-store'}), [token]);
  useEffect(() => {setList(null); setSelected(null); setDetail(null); setCreating(false); setError(''); setMessage('');}, [token]);
  useEffect(() => {
    setList(null); if (!token || !allowed) return;
    const controller = new AbortController(); setReading(true);
    const params = new URLSearchParams({q: query, status, ownership, featured, page: String(page)});
    void request<CircleList>(`/api/admin/circles?${params}`, controller.signal).then(data => {if (!controller.signal.aborted) setList(data);}).catch(value => {if (!controller.signal.aborted) setError(value.message);}).finally(() => {if (!controller.signal.aborted) setReading(false);});
    return () => controller.abort();
  }, [request, token, allowed, query, status, ownership, featured, page, revision]);
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
  if (loading) return <p role="status" className="p-6">正在读取社区管理权限…</p>;
  if (!token || !allowed) return <p role="alert" className="p-6">{accessError || '当前账号没有社区管理查看权限。'}</p>;
  return <main className="space-y-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold">圈子管理</h1><p className="mt-2 text-sm text-muted-foreground">管理站点和用户圈子、前台推荐、公开状态、成员与加入限制。</p></div>{canEdit && <button disabled={busy} className="min-h-11 rounded-lg border px-4" onClick={() => {setCreating(true); setSelected(null); setDetail(null); setError(''); setMessage('');}}>新增站点圈子</button>}</div>
    {error && <p role="alert" className="text-red-400">{error}</p>}{message && <p role="status">{message}</p>}
    <form onSubmit={search} className="grid items-end gap-3 rounded-xl border p-4 sm:grid-cols-2 xl:grid-cols-4"><label className="text-sm">搜索圈子<input aria-label="搜索管理圈子" maxLength={100} value={q} onChange={event => setQ(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border bg-background px-3" placeholder="名称、介绍、标签或圈子编号" /></label><label className="text-sm">圈子状态<select aria-label="管理圈子状态" value={status} onChange={event => {setStatus(event.target.value); setPage(1);}} className="mt-1 min-h-11 w-full rounded-lg border bg-background px-3"><option value="ALL">全部状态</option><option value="ACTIVE">公开</option><option value="HIDDEN">隐藏</option></select></label><label className="text-sm">圈子归属<select aria-label="管理圈子归属" value={ownership} onChange={event => {setOwnership(event.target.value); setPage(1);}} className="mt-1 min-h-11 w-full rounded-lg border bg-background px-3"><option value="ALL">全部归属</option><option value="SITE">站点圈子</option><option value="USER">用户圈子</option></select></label><label className="text-sm">推荐状态<select aria-label="管理圈子推荐" value={featured} onChange={event => {setFeatured(event.target.value); setPage(1);}} className="mt-1 min-h-11 w-full rounded-lg border bg-background px-3"><option value="ALL">全部</option><option value="YES">已推荐</option><option value="NO">未推荐</option></select></label><div className="flex gap-3 sm:col-span-2 xl:col-span-4"><button disabled={busy || reading} className="min-h-11 rounded-lg border px-4">搜索圈子</button><button type="button" disabled={busy || reading} className="min-h-11 rounded-lg border px-4" onClick={() => setRevision(value => value + 1)}>刷新列表</button></div></form>
    {reading && <p role="status">正在查询圈子…</p>}{list && <><div className="max-w-full overflow-x-auto rounded-xl border"><table className="w-full min-w-[850px] text-left text-sm"><thead><tr className="border-b"><th className="p-3">圈子</th><th className="p-3">归属</th><th className="p-3">状态</th><th className="p-3">成员/帖子</th><th className="p-3">更新时间</th><th className="p-3">操作</th></tr></thead><tbody>{list.items.map(circle => <tr key={circle.id} className="border-b align-top"><td className="max-w-72 break-words p-3"><p className="font-semibold">{circle.name}</p><p className="mt-1 break-all text-xs text-muted-foreground">{circle.id}</p><p className="mt-1 text-xs text-muted-foreground">{circle.tags ?? '无标签'}</p></td><td className="max-w-48 break-words p-3">{circle.owner?.username ?? '站点'}</td><td className="p-3">{circle.status === 'ACTIVE' ? '公开' : '隐藏'} · {circle.isFeatured ? '推荐' : '未推荐'}</td><td className="p-3">{circle._count.members} / {circle._count.posts}</td><td className="whitespace-nowrap p-3">{new Date(circle.updatedAt).toLocaleString('zh-CN')}</td><td className="p-3"><button disabled={busy} aria-label={`查看圈子 ${circle.name}`} className="min-h-11 rounded-lg border px-3" onClick={() => {setCreating(false); setSelected(circle.id); setError(''); setMessage('');}}>查看详情</button></td></tr>)}</tbody></table></div>{!list.total && <p>没有匹配的圈子。</p>}<div className="flex flex-wrap items-center gap-3"><span>共 {list.total} 个 · 第 {page} 页</span><button disabled={busy || page <= 1} className="min-h-11 rounded-lg border px-3" onClick={() => setPage(value => value - 1)}>上一页</button><button disabled={busy || page * list.pageSize >= list.total} className="min-h-11 rounded-lg border px-3" onClick={() => setPage(value => value + 1)}>下一页</button></div></>}
    {(creating || detail) && <CircleEditor key={creating ? 'new-circle' : `${detail!.id}:${detail!.updatedAt}`} circle={creating ? null : detail} canEdit={canEdit} busy={busy} onApply={apply} onRefresh={() => {if (detail) void request<ManagedCircle>(`/api/admin/circles/${encodeURIComponent(detail.id)}`).then(data => {setDetail(data); setError(''); setMessage('详情已重新读取。');}).catch(value => setError(value.message));}} onClose={() => {setCreating(false); setSelected(null); setDetail(null);}} />}
    {detail && !creating && <CircleMembers key={detail.id} circleId={detail.id} token={token} canManage={canManageMembers} onChanged={membersChanged} />}
  </main>;
}
