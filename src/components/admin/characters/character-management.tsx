'use client';
import {useCallback, useEffect, useState} from 'react';
import {useAdminAccess} from '../use-admin-access';
import {CharacterBulkActions} from './character-bulk-actions';
import {CharacterEditor} from './character-editor';
import {CharacterModelAccess} from './character-model-access';
import {statusLabels, type CharacterContent, type CharacterSummary, type ManagedCharacter} from './types';
import {apiFetch} from '@/lib/api-client';

export function CharacterManagement() {
  const {token, permissions, loading: accessLoading, error: accessError} = useAdminAccess();
  const allowed = permissions.includes('characters.read'), canEdit = permissions.includes('characters.write'), canPublish = permissions.includes('characters.publish');
  const [selectedRows, setSelectedRows] = useState<Record<string, boolean>>({});
  const [q, setQ] = useState(''), [query, setQuery] = useState(''), [status, setStatus] = useState('ALL'), [tag, setTag] = useState(''), [creator, setCreator] = useState(''), [page, setPage] = useState(1), [refresh, setRefresh] = useState(0);
  const [list, setList] = useState<{items: CharacterSummary[]; total: number; pageSize: number} | null>(null), [selected, setSelected] = useState<string | null>(null), [detail, setDetail] = useState<ManagedCharacter | null>(null), [creating, setCreating] = useState(false);
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [reading, setReading] = useState(false), [detailLoading, setDetailLoading] = useState(false);
  const request = useCallback(<T,>(url: string, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' = 'GET', body?: object, signal?: AbortSignal) => apiFetch<T>(url, {method, token, body, signal, cache: 'no-store'}), [token]);
  useEffect(() => {setList(null); setDetail(null); setSelected(null); setCreating(false);}, [token]);
  useEffect(() => {
    setList(null); setSelectedRows({}); if (!token || !allowed) return;
    const controller = new AbortController(); setReading(true);
    const params = new URLSearchParams({q: query, status, tag, creatorId: creator, page: String(page)});
    void request<{items: CharacterSummary[]; total: number; pageSize: number}>(`/api/admin/characters?${params}`, 'GET', undefined, controller.signal).then(data => {if (!controller.signal.aborted) setList(data);}).catch(value => {if (!controller.signal.aborted) setError(value.message);}).finally(() => {if (!controller.signal.aborted) setReading(false);});
    return () => controller.abort();
  }, [token, allowed, request, query, status, tag, creator, page, refresh]);
  useEffect(() => {
    setDetail(null); if (!selected || !allowed) return;
    const controller = new AbortController(); setDetailLoading(true);
    void request<ManagedCharacter>(`/api/admin/characters/${encodeURIComponent(selected)}`, 'GET', undefined, controller.signal).then(data => {if (!controller.signal.aborted) setDetail(data);}).catch(value => {if (!controller.signal.aborted) setError(value.message);}).finally(() => {if (!controller.signal.aborted) setDetailLoading(false);});
    return () => controller.abort();
  }, [selected, allowed, request, refresh]);
  async function save(content: CharacterContent, reason: string) {
    if (busy) return false; setBusy(true); setError(''); setMessage('');
    try {
      const id = detail?.id;
      const result = await request<{id: string}>(id ? `/api/admin/characters/${encodeURIComponent(id)}` : '/api/admin/characters', id ? 'PUT' : 'POST', {content, reason, ...(id ? {updatedAt: detail!.updatedAt} : {})});
      setCreating(false); setSelected(result.id); setRefresh(value => value + 1); setMessage('角色内容已保存，公开状态由发布流程管理。'); return true;
    } catch (value) {setError((value as Error).message); return false;} finally {setBusy(false);}
  }
  async function publish(action: 'PUBLISH' | 'UNPUBLISH', reason: string) {
    if (busy || !detail) return false; setBusy(true); setError(''); setMessage('');
    try {await request(`/api/admin/characters/${encodeURIComponent(detail.id)}/publication`, 'POST', {action, reason, updatedAt: detail.updatedAt}); setRefresh(value => value + 1); setMessage(action === 'PUBLISH' ? '角色已公开，前台可见性已更新。' : '角色已下架，前台可见性已更新。'); return true;}
    catch (value) {setError((value as Error).message); return false;} finally {setBusy(false);}
  }
  async function bulkPublish(action: 'PUBLISH' | 'UNPUBLISH', reason: string, items: CharacterSummary[]) {
    if (busy) return false; setBusy(true); setError(''); setMessage('');
    try {await request('/api/admin/characters/publication', 'POST', {action, reason, items: items.map(character => ({id: character.id, updatedAt: character.updatedAt}))}); setRefresh(value => value + 1); setMessage('批量角色操作已完成。'); return true;}
    catch (value) {setError((value as Error).message); return false;} finally {setBusy(false);}
  }
  if (accessLoading) return <p role="status" className="p-6">正在读取角色管理权限…</p>;
  if (!token || !allowed) return <p role="alert" className="p-6">{accessError || '当前账号没有角色管理查看权限。'}</p>;
  return <main className="mx-auto max-w-6xl space-y-5 p-4 md:p-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold">角色管理</h1><p className="mt-2 text-sm text-muted-foreground">按状态、标签和作者管理角色，编辑与发布分别授权。后台新增角色及其素材归站点所有，个人作者的角色仍保留原作者归属。</p></div>{canEdit && <button className="min-h-11 rounded-lg border px-4" disabled={busy} onClick={() => {setSelected(null); setDetail(null); setCreating(true); setError(''); setMessage('');}}>新增角色</button>}</div>
    {error && <p role="alert" className="text-red-400">{error}</p>}{message && <p role="status">{message}</p>}
    <form className="grid gap-3 rounded-xl border p-4 sm:grid-cols-2 xl:grid-cols-4" onSubmit={event => {event.preventDefault(); setQuery(q); setPage(1); setRefresh(value => value + 1); setError('');}}><label className="text-sm">搜索角色<input className="mt-1 min-h-11 w-full rounded-lg border bg-background px-3" maxLength={100} value={q} onChange={event => setQ(event.target.value)} placeholder="名称、简介或角色编号" /></label><label className="text-sm">审核状态<select aria-label="审核状态" className="mt-1 min-h-11 w-full rounded-lg border bg-background px-3" value={status} onChange={event => {setStatus(event.target.value); setPage(1);}}><option value="ALL">全部状态</option>{Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="text-sm">标签筛选<input className="mt-1 min-h-11 w-full rounded-lg border bg-background px-3" maxLength={50} value={tag} onChange={event => {setTag(event.target.value); setPage(1);}} /></label><label className="text-sm">作者编号<input className="mt-1 min-h-11 w-full rounded-lg border bg-background px-3" maxLength={100} value={creator} onChange={event => {setCreator(event.target.value); setPage(1);}} /></label><div className="flex gap-3 sm:col-span-2 xl:col-span-4"><button className="min-h-11 rounded-lg border px-4" disabled={reading}>搜索角色</button><button type="button" className="min-h-11 rounded-lg border px-4" disabled={reading} onClick={() => setRefresh(value => value + 1)}>刷新列表</button></div></form>
    {canPublish && list && <CharacterBulkActions items={list.items.filter(character => selectedRows[character.id])} busy={busy} onApply={bulkPublish} />}
    {reading && <p role="status">正在查询角色…</p>}{list && <><div className="max-w-full overflow-x-auto rounded-xl border"><table className="w-full min-w-[760px] text-left text-sm"><thead><tr className="border-b">{canPublish && <th className="p-3">选择</th>}<th className="p-3">角色</th><th className="p-3">归属作者</th><th className="p-3">状态</th><th className="p-3">标签</th><th className="p-3">更新时间</th><th className="p-3">操作</th></tr></thead><tbody>{list.items.map(character => <tr key={character.id} className="border-b align-top">{canPublish && <td className="p-3"><input aria-label={`选择角色 ${character.name}`} type="checkbox" disabled={busy || character.reviewStatus === "DELETED"} checked={!!selectedRows[character.id]} onChange={event => setSelectedRows(previous => ({...previous, [character.id]: event.target.checked}))} /></td>}<td className="max-w-64 break-words p-3"><p className="font-semibold">{character.name}</p><p className="text-muted-foreground">{character.tagline}</p><p className="mt-1 break-all text-xs text-muted-foreground">{character.id}</p></td><td className="p-3">{character.creator?.username ?? '系统'}</td><td className="p-3">{statusLabels[character.reviewStatus]} · {character.isPublic ? '公开' : '不公开'}</td><td className="max-w-48 break-words p-3">{character.tags ?? '无'}</td><td className="whitespace-nowrap p-3">{new Date(character.updatedAt).toLocaleString('zh-CN')}</td><td className="p-3"><button className="min-h-11 rounded-lg border px-3" aria-label={`查看角色 ${character.name}`} disabled={busy} onClick={() => {setCreating(false); setSelected(character.id); setError(''); setMessage('');}}>查看详情</button></td></tr>)}</tbody></table></div>{!list.total && <p>没有匹配的角色。</p>}<div className="flex flex-wrap items-center gap-3"><span>共 {list.total} 个 · 第 {page} 页</span><button className="min-h-11 rounded-lg border px-4 disabled:opacity-50" disabled={page <= 1 || busy} onClick={() => setPage(value => value - 1)}>上一页</button><button className="min-h-11 rounded-lg border px-4 disabled:opacity-50" disabled={page * list.pageSize >= list.total || busy} onClick={() => setPage(value => value + 1)}>下一页</button></div></>}
    {detailLoading && <p role="status">正在读取角色详情…</p>}{(creating || detail) && <CharacterEditor key={creating ? 'new' : `${detail!.id}:${detail!.updatedAt}`} character={creating ? null : detail} canEdit={canEdit} canPublish={canPublish} busy={busy} onSave={save} onPublish={publish} onClose={() => {setCreating(false); setSelected(null); setDetail(null);}} />}
    {detail&&!creating&&<CharacterModelAccess key={detail.id} characterId={detail.id} deleted={detail.reviewStatus==='DELETED'}/>}
  </main>;
}
