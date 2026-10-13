'use client';

import {useCallback, useEffect, useState, type FormEvent} from 'react';
import {useAdminAccess} from './use-admin-access';

type Role = {id: string; name: string; system: boolean; version: number; permissions: {permission: string}[]; _count: {assignments: number}};
type Operator = {userId: string; enabled: boolean; version: number; user: {username: string; email: string; deletedAt: string | null}; assignments: {role: {id: string; name: string}}[]};
type Report = {operators: Operator[]; total: number; pageSize: number; roles: Role[]; definitions: Record<string, string>; ownerOnly: string[]; canManageStaff: boolean; canManageRoles: boolean};
type Selection = {userId: string; username: string; email: string; enabled: boolean; version: number; roleIds: string[]};
const inputClass = 'mt-1 min-h-11 w-full rounded-lg border bg-background px-3';
const buttonClass = 'min-h-11 rounded-lg border px-4 disabled:opacity-50';

export function OperatorManagement() {
  const {token, access, loading, error: accessError, refreshAccess} = useAdminAccess();
  const [report, setReport] = useState<Report | null>(null);
  const [query, setQuery] = useState(''), [search, setSearch] = useState(''), [page, setPage] = useState(1);
  const [lookup, setLookup] = useState(''), [selection, setSelection] = useState<Selection | null>(null);
  const [role, setRole] = useState<Role | null>(null), [roleName, setRoleName] = useState(''), [rolePermissions, setRolePermissions] = useState<string[]>([]);
  const [staffReason, setStaffReason] = useState(''), [roleReason, setRoleReason] = useState('');
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [reading, setReading] = useState(false);

  const request = useCallback(async (url: string, body?: object, signal?: AbortSignal) => {
    const response = await fetch(url, {method: body ? 'POST' : 'GET', headers: {Authorization: `Bearer ${token}`, ...(body ? {'Content-Type': 'application/json'} : {})}, ...(body ? {body: JSON.stringify(body)} : {}), cache: 'no-store', signal});
    const data = await response.json();
    if (!response.ok) throw Error(data.error || '管理操作失败。');
    return data;
  }, [token]);
  const load = useCallback(async (signal?: AbortSignal) => {
    if (!token || !access?.staff) return;
    setReading(true); setError('');
    try {const data = await request(`/api/admin/operators?q=${encodeURIComponent(search)}&page=${page}`, undefined, signal); if (!signal?.aborted) setReport(data);}
    catch (value) {if (!signal?.aborted) {setReport(null); setError((value as Error).message);}}
    finally {if (!signal?.aborted) setReading(false);}
  }, [token, access?.staff, request, search, page]);
  useEffect(() => {setSelection(null); setReport(null);}, [token]);
  useEffect(() => {const controller = new AbortController(); void load(controller.signal); return () => controller.abort();}, [load]);

  async function findUser(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError(''); setMessage(''); setSelection(null);
    try {
      const user = await request(`/api/admin/operators/lookup?q=${encodeURIComponent(lookup.trim())}`);
      setSelection({userId: user.id, username: user.username, email: user.email, enabled: user.adminOperator?.enabled ?? true, version: user.adminOperator?.version ?? 0, roleIds: user.adminOperator?.assignments.map((item: {roleId: string}) => item.roleId) ?? []});
      setStaffReason('');
    } catch (value) {setError((value as Error).message);} finally {setBusy(false);}
  }
  async function saveStaff(event: FormEvent) {
    event.preventDefault(); if (busy || !selection) return;
    setBusy(true); setError(''); setMessage('');
    try {await request('/api/admin/operators', {...selection, reason: staffReason}); setSelection(null); setStaffReason(''); setMessage('管理身份已保存。'); await load(); refreshAccess();}
    catch (value) {setError((value as Error).message);} finally {setBusy(false);}
  }
  function editRole(item: Role | null) {setRole(item); setRoleName(item?.name ?? ''); setRolePermissions(item?.permissions.map(p => p.permission) ?? []); setRoleReason('');}
  async function saveRole(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError(''); setMessage('');
    try {await request('/api/admin/roles', {name: roleName, permissions: rolePermissions, reason: roleReason, ...(role ? {id: role.id, version: role.version} : {})}); editRole(null); setMessage('角色已保存，权限立即生效。'); await load(); refreshAccess();}
    catch (value) {setError((value as Error).message);} finally {setBusy(false);}
  }
  if (loading) return <p role="status" className="p-6">正在读取管理权限…</p>;
  if (!token || !access?.staff) return <p role="alert" className="p-6">{accessError || '当前账号没有权限查看管理人员。'}</p>;
  return <main className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
    <div><h1 className="text-2xl font-bold">管理员与角色</h1><p className="mt-2 text-sm text-muted-foreground">为已有账号分配管理身份，按职责授予权限。</p></div>
    {error && <p role="alert" className="text-red-400">{error}</p>}{message && <p role="status">{message}</p>}
    <section className="space-y-4 rounded-xl border p-4">
      <h2 className="font-bold">管理人员</h2>
      <form className="flex flex-wrap items-end gap-3" onSubmit={event => {event.preventDefault(); setPage(1); setSearch(query);}}>
        <label className="min-w-0 flex-1">搜索用户名或邮箱<input className={inputClass} maxLength={80} value={query} onChange={event => setQuery(event.target.value)} /></label>
        <button className={buttonClass} disabled={reading}>搜索</button><button type="button" className={buttonClass} disabled={reading} onClick={() => void load()}>刷新列表</button>
      </form>
      {reading && <p role="status">正在读取管理人员…</p>}
      {report && <><div className="max-w-full overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm"><thead><tr className="border-b"><th className="p-3">账号</th><th className="p-3">角色</th><th className="p-3">状态</th>{report.canManageStaff && <th className="p-3">操作</th>}</tr></thead><tbody>
        {report.operators.map(item => <tr key={item.userId} className="border-b align-top"><td className="p-3"><p className="font-medium">{item.user.username}</p><p className="break-all text-muted-foreground">{item.user.email}</p></td><td className="p-3">{item.assignments.map(assignment => assignment.role.name).join('、') || '未分配角色'}</td><td className="p-3">{item.user.deletedAt ? '账号已注销' : item.enabled ? '已启用' : '已停用'}</td>{report.canManageStaff && <td className="p-3"><button className={buttonClass} disabled={busy || !!item.user.deletedAt} onClick={() => {setSelection({userId: item.userId, username: item.user.username, email: item.user.email, enabled: item.enabled, version: item.version, roleIds: item.assignments.map(assignment => assignment.role.id)}); setStaffReason('');}}>编辑 {item.user.username}</button></td>}</tr>)}
      </tbody></table></div>{!report.total && <p>暂无匹配的管理账号。</p>}
      <div className="flex flex-wrap items-center gap-3"><span>共 {report.total} 人 · 第 {page} 页</span><button className={buttonClass} disabled={reading || page === 1} onClick={() => setPage(page - 1)}>上一页</button><button className={buttonClass} disabled={reading || page * report.pageSize >= report.total} onClick={() => setPage(page + 1)}>下一页</button></div></>}
    </section>
    {report?.canManageStaff && <section className="space-y-4 rounded-xl border p-4"><h2 className="font-bold">分配管理身份</h2>
      <form className="flex flex-wrap items-end gap-3" onSubmit={findUser}><label className="min-w-0 flex-1">查找已有账号<input required className={inputClass} maxLength={150} placeholder="完整用户名或登录邮箱" value={lookup} onChange={event => setLookup(event.target.value)} /></label><button className={buttonClass} disabled={busy}>查找账号</button></form>
      {selection && <form className="space-y-4 border-t pt-4" onSubmit={saveStaff}><p className="break-all font-medium">正在编辑：{selection.username} · {selection.email}</p>
        <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={selection.enabled} onChange={event => setSelection({...selection, enabled: event.target.checked})} />启用管理身份</label>
        <fieldset><legend className="mb-2 text-sm font-medium">分配角色</legend><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{report.roles.map(item => <label key={item.id} className="flex min-h-11 items-center gap-2 rounded-lg border p-3"><input type="checkbox" checked={selection.roleIds.includes(item.id)} onChange={event => setSelection({...selection, roleIds: event.target.checked ? [...selection.roleIds, item.id] : selection.roleIds.filter(id => id !== item.id)})} />{item.name}</label>)}</div></fieldset>
        <label className="block">操作理由<textarea required maxLength={300} className={`${inputClass} min-h-24 py-2`} value={staffReason} onChange={event => setStaffReason(event.target.value)} /></label>
        <div className="flex gap-3"><button className={buttonClass} disabled={busy}>保存管理身份</button><button type="button" className={buttonClass} disabled={busy} onClick={() => setSelection(null)}>取消</button></div>
      </form>}
    </section>}
    {report && <section className="space-y-4 rounded-xl border p-4"><h2 className="font-bold">角色与权限</h2><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{report.roles.map(item => <article key={item.id} className="space-y-2 rounded-lg border p-4"><h3 className="font-semibold">{item.name}</h3><p className="text-sm text-muted-foreground">{item.system ? '系统角色' : '自定义角色'} · {item._count.assignments} 人</p><ul className="space-y-1 text-sm">{item.permissions.map(permission => <li key={permission.permission}>{report.definitions[permission.permission] ?? permission.permission}</li>)}</ul>{report.canManageRoles && !item.system && <button className={buttonClass} disabled={busy} onClick={() => editRole(item)}>编辑角色 {item.name}</button>}</article>)}</div>
      {report.canManageRoles && <form className="space-y-4 border-t pt-4" onSubmit={saveRole}><h3 className="font-semibold">{role ? `编辑角色：${role.name}` : '新增自定义角色'}</h3><label className="block">角色名称<input required maxLength={60} className={inputClass} value={roleName} onChange={event => setRoleName(event.target.value)} /></label>
        <fieldset><legend className="mb-2 text-sm font-medium">业务权限</legend><div className="grid gap-2 md:grid-cols-2">{Object.entries(report.definitions).filter(([key]) => !report.ownerOnly.includes(key)).map(([key, label]) => <label key={key} className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={rolePermissions.includes(key)} onChange={event => setRolePermissions(event.target.checked ? [...rolePermissions, key] : rolePermissions.filter(permission => permission !== key))} />{label}</label>)}</div></fieldset>
        <label className="block">修改理由<textarea required maxLength={300} className={`${inputClass} min-h-24 py-2`} value={roleReason} onChange={event => setRoleReason(event.target.value)} /></label><div className="flex gap-3"><button className={buttonClass} disabled={busy}>保存角色</button>{role && <button type="button" className={buttonClass} disabled={busy} onClick={() => editRole(null)}>取消编辑</button>}</div>
      </form>}
    </section>}
  </main>;
}
