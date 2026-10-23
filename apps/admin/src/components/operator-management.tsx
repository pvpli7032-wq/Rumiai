'use client';

import {useCallback, useEffect, useState, type FormEvent} from 'react';
import {RefreshCw, Search} from 'lucide-react';
import {useAdminAccess} from './use-admin-access';
import {apiFetch} from '@admin/lib/api-client';
import {AdminNotice, AdminPage, AdminPageHeader, AdminPanel} from './admin-page';
import {Badge} from '@rumiai/ui/badge';
import {Button} from '@rumiai/ui/button';
import {DataTable} from '@admin/components/layout/data-table';
import {EmptyState} from '@rumiai/ui/empty-state';
import {Input} from '@rumiai/ui/input';
import {Pagination} from '@rumiai/ui/pagination';
import {Textarea} from '@rumiai/ui/textarea';

type Role = {id: string; name: string; system: boolean; version: number; permissions: {permission: string}[]; _count: {assignments: number}};
type Operator = {userId: string; enabled: boolean; version: number; user: {username: string; email: string; deletedAt: string | null}; assignments: {role: {id: string; name: string}}[]};
type Report = {operators: Operator[]; total: number; pageSize: number; roles: Role[]; definitions: Record<string, string>; ownerOnly: string[]; canManageStaff: boolean; canManageRoles: boolean};
type LookupUser = {id: string; username: string; email: string; adminOperator: {enabled: boolean; version: number; assignments: {roleId: string}[]} | null};
type Selection = {userId: string; username: string; email: string; enabled: boolean; version: number; roleIds: string[]};

export function OperatorManagement() {
  const {sessionActive, access, loading, error: accessError, refreshAccess} = useAdminAccess();
  const [report, setReport] = useState<Report | null>(null);
  const [query, setQuery] = useState(''), [search, setSearch] = useState(''), [page, setPage] = useState(1);
  const [lookup, setLookup] = useState(''), [selection, setSelection] = useState<Selection | null>(null);
  const [role, setRole] = useState<Role | null>(null), [roleName, setRoleName] = useState(''), [rolePermissions, setRolePermissions] = useState<string[]>([]);
  const [staffReason, setStaffReason] = useState(''), [roleReason, setRoleReason] = useState('');
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [reading, setReading] = useState(false);

  const request = useCallback(<T,>(url: string, body?: object, signal?: AbortSignal) => apiFetch<T>(url, {method: body ? 'POST' : 'GET', credentials: 'same-origin', body, signal, cache: 'no-store'}), [sessionActive]);
  const load = useCallback(async (signal?: AbortSignal) => {
    if (!sessionActive || !access?.staff) return;
    setReading(true); setError('');
    try {const data = await request<Report>(`/api/admin/operators?q=${encodeURIComponent(search)}&page=${page}`, undefined, signal); if (!signal?.aborted) setReport(data);}
    catch (value) {if (!signal?.aborted) {setReport(null); setError((value as Error).message);}}
    finally {if (!signal?.aborted) setReading(false);}
  }, [sessionActive, access?.staff, request, search, page]);
  useEffect(() => {setSelection(null); setReport(null);}, [sessionActive]);
  useEffect(() => {const controller = new AbortController(); void load(controller.signal); return () => controller.abort();}, [load]);

  async function findUser(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError(''); setMessage(''); setSelection(null);
    try {
      const user = await request<LookupUser>(`/api/admin/operators/lookup?q=${encodeURIComponent(lookup.trim())}`);
      setSelection({userId: user.id, username: user.username, email: user.email, enabled: user.adminOperator?.enabled ?? true, version: user.adminOperator?.version ?? 0, roleIds: user.adminOperator?.assignments.map(item => item.roleId) ?? []});
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
  if (loading) return <AdminPage><AdminNotice tone="loading" title="正在读取管理权限…" /></AdminPage>;
  if (!sessionActive || !access?.staff) return <AdminPage><AdminNotice tone="denied" title={accessError || '当前账号没有权限查看管理人员。'} /></AdminPage>;
  return <AdminPage width="default">
    <AdminPageHeader eyebrow="系统与安全" title="管理员与角色" description="为已有账号分配管理身份，按职责授予权限。" />
    {error && <AdminNotice tone="error" title={error} className="py-6" />}
    {message && <AdminNotice tone="success" title={message} className="py-6" />}
    <AdminPanel title="管理人员" description="搜索用户名或邮箱定位已有管理账号。" badge={report && <Badge>{report.total} 人</Badge>}>
      <form className="flex flex-wrap items-end gap-3" onSubmit={event => {event.preventDefault(); setPage(1); setSearch(query);}}>
        <label className="block min-w-0 flex-1 space-y-1.5">
          <span className="text-sm font-medium">搜索用户名或邮箱</span>
          <Input maxLength={80} value={query} onChange={event => setQuery(event.target.value)} />
        </label>
        <Button type="submit" leadingIcon={<Search className="h-4 w-4" />} disabled={reading}>搜索</Button>
        <Button type="button" variant="outline" leadingIcon={<RefreshCw className="h-4 w-4" />} disabled={reading} onClick={() => void load()}>刷新列表</Button>
      </form>
      {reading && <AdminNotice tone="loading" title="正在读取管理人员…" className="py-6" />}
      {report && <>
        <DataTable
          rows={report.operators}
          getRowId={item => item.userId}
          empty={<EmptyState title="暂无匹配的管理账号" />}
          columns={[
            {id: 'account', header: '账号', cell: item => (
              <span className="block">
                <span className="block font-medium">{item.user.username}</span>
                <span className="mt-0.5 block break-all text-xs text-muted-foreground">{item.user.email}</span>
              </span>
            )},
            {id: 'roles', header: '角色', cell: item => <span className="text-sm text-muted-foreground">{item.assignments.map(assignment => assignment.role.name).join('、') || '未分配角色'}</span>},
            {id: 'status', header: '状态', width: '120px', cell: item => (
              <Badge variant={item.user.deletedAt ? 'danger' : item.enabled ? 'success' : 'neutral'}>{item.user.deletedAt ? '账号已注销' : item.enabled ? '已启用' : '已停用'}</Badge>
            )},
            ...(report.canManageStaff ? [{id: 'actions', header: '操作', width: '140px', cell: (item: Operator) => (
              <Button size="sm" variant="outline" aria-label={`编辑 ${item.user.username}`} disabled={busy || !!item.user.deletedAt} onClick={() => {setSelection({userId: item.userId, username: item.user.username, email: item.user.email, enabled: item.enabled, version: item.version, roleIds: item.assignments.map(assignment => assignment.role.id)}); setStaffReason('');}}>编辑</Button>
            )}] : []),
          ]}
        />
        <Pagination page={page} pageCount={Math.max(1, Math.ceil(report.total / report.pageSize))} onPageChange={value => setPage(value)} summary={`共 ${report.total} 人`} disabled={reading} className="mt-4" />
      </>}
    </AdminPanel>
    {report?.canManageStaff && <AdminPanel title="分配管理身份" description="先按完整用户名或登录邮箱查找已有账号，再启用身份与分配角色。">
      <form className="flex flex-wrap items-end gap-3" onSubmit={findUser}>
        <label className="block min-w-0 flex-1 space-y-1.5">
          <span className="text-sm font-medium">查找已有账号</span>
          <Input required maxLength={150} placeholder="完整用户名或登录邮箱" value={lookup} onChange={event => setLookup(event.target.value)} />
        </label>
        <Button type="submit" disabled={busy}>查找账号</Button>
      </form>
      {selection && <form className="space-y-4 border-t border-border pt-4" onSubmit={saveStaff}>
        <p className="break-all text-sm font-medium text-foreground">正在编辑：{selection.username} · {selection.email}</p>
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 rounded border-border accent-brand" checked={selection.enabled} onChange={event => setSelection({...selection, enabled: event.target.checked})} />启用管理身份</label>
        <fieldset><legend className="mb-2 text-sm font-medium">分配角色</legend><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{report.roles.map(item => <label key={item.id} className="flex min-h-11 items-center gap-2 rounded-lg border p-3 text-sm"><input type="checkbox" className="h-4 w-4 shrink-0 rounded border-border accent-brand" checked={selection.roleIds.includes(item.id)} onChange={event => setSelection({...selection, roleIds: event.target.checked ? [...selection.roleIds, item.id] : selection.roleIds.filter(id => id !== item.id)})} />{item.name}</label>)}</div></fieldset>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">操作理由</span>
          <Textarea required maxLength={300} rows={3} value={staffReason} onChange={event => setStaffReason(event.target.value)} />
        </label>
        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={busy}>保存管理身份</Button>
          <Button type="button" variant="outline" disabled={busy} onClick={() => setSelection(null)}>取消</Button>
        </div>
      </form>}
    </AdminPanel>}
    {report && <AdminPanel title="角色与权限" description="每个角色显式列出其包含的业务权限；系统角色不可编辑。">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{report.roles.map(item => <article key={item.id} className="space-y-2 rounded-lg border border-border p-4"><h3 className="text-sm font-semibold text-foreground">{item.name}</h3><p className="text-xs text-muted-foreground">{item.system ? '系统角色' : '自定义角色'} · {item._count.assignments} 人</p><ul className="space-y-1 text-sm text-muted-foreground">{item.permissions.map(permission => <li key={permission.permission}>{report.definitions[permission.permission] ?? permission.permission}</li>)}</ul>{report.canManageRoles && !item.system && <Button size="sm" variant="outline" disabled={busy} onClick={() => editRole(item)}>编辑角色</Button>}</article>)}</div>
      {report.canManageRoles && <form className="mt-5 space-y-4 border-t border-border pt-4" onSubmit={saveRole}>
        <h3 className="text-sm font-semibold text-foreground">{role ? `编辑角色：${role.name}` : '新增自定义角色'}</h3>
        <label className="block space-y-1.5 text-sm font-medium text-foreground">角色名称
          <Input required maxLength={60} value={roleName} onChange={event => setRoleName(event.target.value)} />
        </label>
        <fieldset><legend className="mb-2 text-sm font-medium">业务权限</legend><div className="grid gap-2 md:grid-cols-2">{Object.entries(report.definitions).filter(([key]) => !report.ownerOnly.includes(key)).map(([key, label]) => <label key={key} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 rounded border-border accent-brand" checked={rolePermissions.includes(key)} onChange={event => setRolePermissions(event.target.checked ? [...rolePermissions, key] : rolePermissions.filter(permission => permission !== key))} />{label}</label>)}</div></fieldset>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">修改理由</span>
          <Textarea required maxLength={300} rows={3} value={roleReason} onChange={event => setRoleReason(event.target.value)} />
        </label>
        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={busy}>保存角色</Button>
          {role && <Button type="button" variant="outline" disabled={busy} onClick={() => editRole(null)}>取消编辑</Button>}
        </div>
      </form>}
    </AdminPanel>}
  </AdminPage>;
}
