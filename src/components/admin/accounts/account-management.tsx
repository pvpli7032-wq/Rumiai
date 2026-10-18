'use client';
import {useCallback, useEffect, useState, type FormEvent} from 'react';
import {useAdminAccess} from '../use-admin-access';
import {AccountTable} from './account-table';
import {ManagedAccountDetail} from './account-detail';
import {actionLabels, type AccountAction, type AccountDetail, type AccountList} from './types';

export function AccountManagement() {
  const {token, permissions, loading: accessLoading, error: accessError} = useAdminAccess();
  const allowed = permissions.includes('accounts.read');
  const [q, setQ] = useState(''), [query, setQuery] = useState(''), [status, setStatus] = useState('ALL'), [community, setCommunity] = useState('ALL'), [sort, setSort] = useState('NEWEST'), [page, setPage] = useState(1);
  const [list, setList] = useState<AccountList | null>(null), [selected, setSelected] = useState<string | null>(null), [detail, setDetail] = useState<AccountDetail | null>(null);
  const [reading, setReading] = useState(false), [detailLoading, setDetailLoading] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState(''), [refresh, setRefresh] = useState(0);
  const request = useCallback(async (url: string, signal?: AbortSignal, body?: object) => {
    const response = await fetch(url, {method: body ? 'PATCH' : 'GET', headers: {Authorization: `Bearer ${token}`, ...(body ? {'Content-Type': 'application/json'} : {})}, cache: 'no-store', signal, ...(body ? {body: JSON.stringify(body)} : {})});
    const data = await response.json(); if (!response.ok) throw Error(data.error || '用户管理请求失败。'); return data;
  }, [token]);
  useEffect(() => {setList(null); setSelected(null); setDetail(null); setMessage('');}, [token]);
  useEffect(() => {
    setList(null); if (!token || !allowed) return;
    const controller = new AbortController(); setReading(true);
    const params = new URLSearchParams({q: query, status, community, sort, page: String(page)});
    void request(`/api/admin/accounts?${params}`, controller.signal).then(data => {if (!controller.signal.aborted) setList(data);}).catch(value => {if (!controller.signal.aborted) setError(value.message);}).finally(() => {if (!controller.signal.aborted) setReading(false);});
    return () => controller.abort();
  }, [token, allowed, request, query, status, community, sort, page, refresh]);
  useEffect(() => {
    setDetail(null); if (!selected || !allowed) return;
    const controller = new AbortController(); setDetailLoading(true);
    void request(`/api/admin/accounts/${encodeURIComponent(selected)}`, controller.signal).then(data => {if (!controller.signal.aborted) setDetail(data);}).catch(value => {if (!controller.signal.aborted) setError(value.message);}).finally(() => {if (!controller.signal.aborted) setDetailLoading(false);});
    return () => controller.abort();
  }, [selected, allowed, request, refresh]);
  async function applyAction(action: AccountAction, reason: string) {
    if (!detail || busy) return false;
    setBusy(true); setError(''); setMessage('');
    try {await request(`/api/admin/accounts/${encodeURIComponent(detail.user.id)}`, undefined, {action, reason, version: detail.user.accountVersion}); setMessage(`${actionLabels[action]}已完成。`); setRefresh(value => value + 1); return true;}
    catch (value) {setError((value as Error).message); setRefresh(value => value + 1); return false;} finally {setBusy(false);}
  }
  function search(event: FormEvent) {event.preventDefault(); setError(''); setPage(1); setQuery(q); setRefresh(value => value + 1);}
  if (accessLoading) return <p role="status" className="p-6">正在读取管理权限…</p>;
  if (!token || !allowed) return <p role="alert" className="p-6">{accessError || '当前账号没有用户管理查看权限。'}</p>;
  return <main className="mx-auto max-w-6xl space-y-5 p-4 md:p-6"><div><h1 className="text-2xl font-bold">用户管理</h1><p className="mt-2 text-sm text-muted-foreground">查询用户、管理账号状态和社区权限，查看关联业务记录。</p></div>
    {error && <p role="alert" className="text-red-400">{error}</p>}{message && <p role="status">{message}</p>}
    <form className="grid items-end gap-3 rounded-xl border p-4 sm:grid-cols-2 xl:grid-cols-5" onSubmit={search}><label className="text-sm sm:col-span-2">搜索用户<input className="mt-1 min-h-11 w-full rounded-lg border bg-background px-3" placeholder="用户名、邮箱、昵称或用户编号" maxLength={100} value={q} onChange={event => setQ(event.target.value)} /></label><label className="text-sm">账号状态<select className="mt-1 min-h-11 w-full rounded-lg border bg-background px-2" value={status} onChange={event => {setStatus(event.target.value); setPage(1);}}><option value="ALL">全部账号</option><option value="ACTIVE">正常</option><option value="SUSPENDED">已停用</option><option value="CLOSED">已注销</option></select></label><label className="text-sm">社区权限<select className="mt-1 min-h-11 w-full rounded-lg border bg-background px-2" value={community} onChange={event => {setCommunity(event.target.value); setPage(1);}}><option value="ALL">全部</option><option value="BANNED">已禁言</option><option value="CLEAR">未禁言</option></select></label><label className="text-sm">排序<select className="mt-1 min-h-11 w-full rounded-lg border bg-background px-2" value={sort} onChange={event => {setSort(event.target.value); setPage(1);}}><option value="NEWEST">最新注册</option><option value="OLDEST">最早注册</option><option value="ACTIVE">最近活动</option></select></label><div className="flex gap-3 sm:col-span-2 xl:col-span-5"><button className="min-h-11 rounded-lg border px-4" disabled={reading || busy}>搜索用户</button><button type="button" className="min-h-11 rounded-lg border px-4" disabled={reading || busy} onClick={() => setRefresh(value => value + 1)}>刷新</button></div></form>
    {reading && <p role="status">正在查询用户…</p>}{list && <><AccountTable items={list.items} selected={selected} onSelect={id => {if (!busy) {setSelected(id); setMessage(''); setError('');}}} />{!list.total && <p>没有匹配的用户。</p>}<div className="flex flex-wrap items-center gap-3"><span>共 {list.total} 人 · 第 {page} 页</span><button className="min-h-11 rounded-lg border px-4 disabled:opacity-50" disabled={busy || page <= 1} onClick={() => setPage(value => value - 1)}>上一页</button><button className="min-h-11 rounded-lg border px-4 disabled:opacity-50" disabled={busy || page * list.pageSize >= list.total} onClick={() => setPage(value => value + 1)}>下一页</button></div></>}
    {detailLoading && <p role="status">正在读取用户详情…</p>}{detail && <ManagedAccountDetail key={detail.user.id} detail={detail} permissions={permissions} busy={busy} onAction={applyAction} onClose={() => setSelected(null)} />}
  </main>;
}
