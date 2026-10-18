'use client';
import {useCallback, useEffect, useState, type FormEvent} from 'react';
import {memberActionLabels, type ManagedCircleMember, type MemberAction, type MemberList} from './types';

export function CircleMembers({circleId, token, canManage, onChanged}: {circleId: string; token: string; canManage: boolean; onChanged: () => void}) {
  const [q, setQ] = useState(''), [query, setQuery] = useState(''), [status, setStatus] = useState('MEMBER'), [page, setPage] = useState(1), [refresh, setRefresh] = useState(0);
  const [list, setList] = useState<MemberList | null>(null), [reading, setReading] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [selected, setSelected] = useState<{member: ManagedCircleMember; action: MemberAction} | null>(null), [reason, setReason] = useState('');
  const request = useCallback(async (url: string, signal?: AbortSignal, body?: object) => {
    const response = await fetch(url, {method: body ? 'PATCH' : 'GET', headers: {Authorization: `Bearer ${token}`, ...(body ? {'Content-Type': 'application/json'} : {})}, cache: 'no-store', signal, ...(body ? {body: JSON.stringify(body)} : {})});
    const data = await response.json(); if (!response.ok) throw Error(data.error || '成员管理请求失败。'); return data;
  }, [token]);
  useEffect(() => {setSelected(null); setReason(''); setError(''); setMessage('');}, [token, circleId, status]);
  useEffect(() => {
    const controller = new AbortController(); setList(null); setReading(true);
    const params = new URLSearchParams({q: query, status, page: String(page)});
    void request(`/api/admin/circles/${encodeURIComponent(circleId)}/members?${params}`, controller.signal).then(data => {if (!controller.signal.aborted) setList(data);}).catch(value => {if (!controller.signal.aborted) setError(value.message);}).finally(() => {if (!controller.signal.aborted) setReading(false);});
    return () => controller.abort();
  }, [request, circleId, query, status, page, refresh]);
  function search(event: FormEvent) {event.preventDefault(); setError(''); setPage(1); setQuery(q); setRefresh(value => value + 1);}
  async function apply() {
    if (!selected || busy || !reason.trim()) return;
    setBusy(true); setError(''); setMessage('');
    try {
      await request(`/api/admin/circles/${encodeURIComponent(circleId)}/members/${encodeURIComponent(selected.member.userId)}`, undefined, {action: selected.action, updatedAt: selected.member.updatedAt, reason});
      setMessage(`${memberActionLabels[selected.action]}已完成。`); setSelected(null); setReason(''); onChanged();
    } catch (value) {setError((value as Error).message);} finally {setBusy(false); setRefresh(value => value + 1);}
  }
  return <section className="space-y-4 rounded-xl border p-4 md:p-6" aria-label="圈子成员管理"><h2 className="text-xl font-semibold">成员与加入限制</h2><p className="text-sm text-muted-foreground">移除成员后仍可自行重新订阅；限制加入后必须由运营解除，解除不会自动替用户加入。</p>{error && <p role="alert" className="text-red-400">{error}</p>}{message && <p role="status">{message}</p>}
    <form onSubmit={search} className="grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-3"><label className="min-w-0 text-sm sm:col-span-2 xl:col-span-1">搜索成员<input aria-label="搜索圈子成员" maxLength={100} value={q} onChange={event => setQ(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border bg-background px-3" placeholder="用户名、昵称或用户编号" /></label><label className="text-sm">成员状态<select aria-label="圈子成员状态" className="mt-1 min-h-11 w-full rounded-lg border bg-background px-3" value={status} onChange={event => {setStatus(event.target.value); setPage(1);}}><option value="MEMBER">已订阅成员</option><option value="BLOCKED">限制加入</option></select></label><button className="min-h-11 rounded-lg border px-4" disabled={busy || reading}>搜索成员</button></form>
    {reading && <p role="status">正在读取成员…</p>}{list && <><div className="max-w-full overflow-x-auto rounded-lg border"><table className="w-full min-w-[650px] text-left text-sm"><thead><tr className="border-b"><th className="p-3">用户</th><th className="p-3">账号状态</th><th className="p-3">加入/限制时间</th><th className="p-3">限制理由</th>{canManage && <th className="p-3">操作</th>}</tr></thead><tbody>{list.items.map(member => <tr key={member.userId} className="border-b align-top"><td className="max-w-60 break-words p-3"><p>{member.user.displayName || member.user.username}</p><p className="mt-1 break-all text-xs text-muted-foreground">{member.userId}</p></td><td className="p-3">{member.user.deletedAt ? '已注销' : member.user.suspendedAt ? '已停用' : '正常'}</td><td className="whitespace-nowrap p-3">{new Date(member.createdAt).toLocaleString('zh-CN')}</td><td className="max-w-64 whitespace-pre-wrap break-words p-3">{member.reason ?? '无'}</td>{canManage && <td className="p-3"><div className="flex flex-wrap gap-2">{(status === 'BLOCKED' ? ['UNBLOCK'] : ['REMOVE', 'BLOCK']).map(action => <button key={action} disabled={busy || !!member.user.deletedAt} aria-label={`${memberActionLabels[action as MemberAction]} ${member.user.username}`} className="min-h-11 rounded-lg border px-3" onClick={() => {setSelected({member, action: action as MemberAction}); setReason(''); setError(''); setMessage('');}}>{memberActionLabels[action as MemberAction]}</button>)}</div></td>}</tr>)}</tbody></table></div>{!list.total && <p>没有匹配的成员。</p>}<div className="flex flex-wrap items-center gap-3"><span>共 {list.total} 条 · 第 {page} 页</span><button disabled={busy || page <= 1} className="min-h-11 rounded-lg border px-3" onClick={() => setPage(value => value - 1)}>上一页</button><button disabled={busy || page * list.pageSize >= list.total} className="min-h-11 rounded-lg border px-3" onClick={() => setPage(value => value + 1)}>下一页</button></div></>}
    {selected && canManage && <div className="space-y-3 rounded-lg border p-4"><p>{memberActionLabels[selected.action]}：{selected.member.user.username}</p><label className="block text-sm">成员处置理由<textarea aria-label="成员处置理由" maxLength={500} value={reason} onChange={event => setReason(event.target.value)} className="mt-1 min-h-20 w-full rounded-lg border bg-background p-3" /></label><div className="flex gap-3"><button disabled={busy || !reason.trim()} className="min-h-11 rounded-lg border px-4" onClick={() => void apply()}>确认{memberActionLabels[selected.action]}</button><button disabled={busy} className="min-h-11 rounded-lg border px-4" onClick={() => setSelected(null)}>取消处置</button></div></div>}
  </section>;
}
