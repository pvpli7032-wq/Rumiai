'use client';
import {useCallback, useEffect, useRef, useState, type FormEvent} from 'react';
import {RefreshCw, Search} from 'lucide-react';
import {useAdminAccess} from '../use-admin-access';
import {AccountTable} from './account-table';
import {ManagedAccountDetail} from './account-detail';
import {actionLabels, type AccountAction, type AccountDetail, type AccountList} from './types';
import {apiFetch} from '@admin/lib/api-client';
import {AdminNotice, AdminPage, AdminPageHeader, AdminPanel} from '../admin-page';
import {Badge} from '@rumiai/ui/badge';
import {Button} from '@rumiai/ui/button';
import {Input} from '@rumiai/ui/input';
import {Select} from '@rumiai/ui/select';
import {DetailDrawer} from '../layout/detail-drawer';

export function AccountManagement() {
  const {sessionActive, permissions, loading: accessLoading, error: accessError} = useAdminAccess();
  const allowed = permissions.includes('accounts.read');
  const [q, setQ] = useState(''), [query, setQuery] = useState(''), [status, setStatus] = useState('ALL'), [community, setCommunity] = useState('ALL'), [sort, setSort] = useState('NEWEST'), [page, setPage] = useState(1);
  /**
   * 注册日期区间（UTC 日，含结束当天）。null 表示还没读到 URL —— 此时不发请求，
   * 免得先按「无日期」查一次、再按 URL 里的日期查第二次。
   * 用 window.location 而不是 useSearchParams：后者会强制包一层 Suspense
   * （见 app/[locale]/auth/auth-form.tsx 里同一处取舍）。
   */
  const [registered, setRegistered] = useState<{from: string; until: string} | null>(null);
  const [list, setList] = useState<AccountList | null>(null), [selected, setSelected] = useState<string | null>(null), [detail, setDetail] = useState<AccountDetail | null>(null);
  const [createForm, setCreateForm] = useState({email: '', username: '', displayName: '', reason: ''});
  const [reading, setReading] = useState(false), [detailLoading, setDetailLoading] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [detailError, setDetailError] = useState(''), [message, setMessage] = useState(''), [refresh, setRefresh] = useState(0), [detailDirty, setDetailDirty] = useState(false);
  const actionBusyRef = useRef(false);
  const request = useCallback(<T,>(url: string, signal?: AbortSignal, body?: object) => apiFetch<T>(url, {method: body ? 'PATCH' : 'GET', credentials: 'same-origin', body, signal, cache: 'no-store'}), [sessionActive]);
  useEffect(() => {setList(null); setSelected(null); setDetail(null); setMessage('');}, [sessionActive]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setRegistered({from: params.get('from') ?? '', until: params.get('until') ?? ''});
  }, []);
  useEffect(() => {
    if (!registered) return;
    if (!sessionActive || !allowed) { setList(null); return; }
    const controller = new AbortController(); setReading(true);
    const params = new URLSearchParams({q: query, status, community, sort, page: String(page), from: registered.from, until: registered.until});
    void request<AccountList>(`/api/admin/accounts?${params}`, controller.signal).then(data => {if (!controller.signal.aborted) setList(data);}).catch(value => {if (!controller.signal.aborted) setError(value.message);}).finally(() => {if (!controller.signal.aborted) setReading(false);});
    return () => controller.abort();
  }, [sessionActive, allowed, request, query, status, community, sort, page, refresh, registered]);
  useEffect(() => {
    setDetail(current => current?.user.id === selected ? current : null); setDetailError(''); if (!selected || !allowed) return;
    const controller = new AbortController(); setDetailLoading(true);
    const requestedId = selected;
    void request<AccountDetail>(`/api/admin/accounts/${encodeURIComponent(requestedId)}`, controller.signal).then(data => {if (!controller.signal.aborted && requestedId === selected) setDetail(data);}).catch(value => {if (!controller.signal.aborted && requestedId === selected) setDetailError(value instanceof Error ? value.message : '用户详情读取失败，请重试。');}).finally(() => {if (!controller.signal.aborted && requestedId === selected) setDetailLoading(false);});
    return () => controller.abort();
  }, [selected, allowed, request, refresh]);
  async function applyAction(action: AccountAction, reason: string) {
    if (!detail || actionBusyRef.current) return false;
    actionBusyRef.current = true;
    setBusy(true); setError(''); setMessage('');
    try {await request(`/api/admin/accounts/${encodeURIComponent(detail.user.id)}`, undefined, {action, reason, version: detail.user.accountVersion}); setMessage(`${actionLabels[action]}已完成。`); setRefresh(value => value + 1); return true;}
    catch (value) {setError((value as Error).message); setRefresh(value => value + 1); return false;} finally {actionBusyRef.current = false; setBusy(false);}
  }
  async function createAccount(event: FormEvent) {
    event.preventDefault(); if (actionBusyRef.current || !permissions.includes('accounts.manage')) return;
    actionBusyRef.current = true; setBusy(true); setError(''); setMessage('');
    try { await apiFetch('/api/admin/accounts', {method: 'POST', credentials: 'same-origin', body: createForm}); setMessage('账号已创建为待激活状态，一次性激活邮件已进入已配置的发送通道。'); setCreateForm({email: '', username: '', displayName: '', reason: ''}); setRefresh(value => value + 1); }
    catch (value) {setError((value as Error).message);} finally {actionBusyRef.current = false; setBusy(false);}
  }
  function search(event: FormEvent) {event.preventDefault(); setError(''); setPage(1); setQuery(q); setRefresh(value => value + 1);}
  function closeDetail() {
    if (busy) return;
    if (detailDirty && !window.confirm('当前用户详情有未保存修改，关闭会丢失这些输入。确定关闭吗？')) return;
    setSelected(null); setDetailDirty(false);
  }
  if (accessLoading) return <AdminPage><AdminNotice tone="loading" title="正在读取管理权限…" /></AdminPage>;
  if (!sessionActive || !allowed) return <AdminPage><AdminNotice tone="denied" title={accessError || '当前账号没有用户管理查看权限。'} /></AdminPage>;
  return <AdminPage>
    <AdminPageHeader eyebrow="用户与客服" title="用户管理" description="查询用户、管理账号状态和社区权限，查看关联业务记录。" />
    {error && <AdminNotice tone="error" title={error} className="py-6" />}
    {message && <AdminNotice tone="success" title={message} className="py-6" />}
    {permissions.includes('accounts.manage') && <AdminPanel title="新增网站账号" description="账号初始保持停用；用户只能通过 24 小时一次性激活链接设置密码。生产环境未配置邮件时会明确失败，不会伪装已发送。">
      <form className="grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-4" onSubmit={createAccount}>
        <label className="space-y-1.5 text-sm font-medium">邮箱<Input type="email" required value={createForm.email} onChange={event => setCreateForm(value => ({...value, email: event.target.value}))} /></label>
        <label className="space-y-1.5 text-sm font-medium">用户名（可留空自动生成）<Input value={createForm.username} onChange={event => setCreateForm(value => ({...value, username: event.target.value}))} /></label>
        <label className="space-y-1.5 text-sm font-medium">显示名称<Input required value={createForm.displayName} onChange={event => setCreateForm(value => ({...value, displayName: event.target.value}))} /></label>
        <label className="space-y-1.5 text-sm font-medium">创建理由<Input required value={createForm.reason} onChange={event => setCreateForm(value => ({...value, reason: event.target.value}))} /></label>
        <Button type="submit" disabled={busy} className="sm:col-span-2 xl:col-span-1">{busy ? '创建中…' : '创建并发送激活'}</Button>
      </form>
    </AdminPanel>}
    <AdminPanel title="筛选检索" description="按用户身份、状态与注册时间组合检索；选中用户后在详情面板继续处理资料和关联资产。" badge={list && <Badge variant="brand">{list.total} 人</Badge>}>
      <form className="grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-5" onSubmit={search}>
        <label className="space-y-1.5 text-sm font-medium text-foreground sm:col-span-2">搜索用户
          <Input placeholder="用户名、邮箱、昵称或用户编号" maxLength={100} value={q} onChange={event => setQ(event.target.value)} />
        </label>
        <label className="space-y-1.5 text-sm font-medium text-foreground">账号状态
          <Select aria-label="账号状态" value={status} onChange={event => {setStatus(event.target.value); setPage(1);}}><option value="ALL">全部账号</option><option value="ACTIVE">正常</option><option value="SUSPENDED">已停用</option><option value="CLOSED">已注销</option></Select>
        </label>
        <label className="space-y-1.5 text-sm font-medium text-foreground">社区权限
          <Select aria-label="社区权限" value={community} onChange={event => {setCommunity(event.target.value); setPage(1);}}><option value="ALL">全部</option><option value="BANNED">已禁言</option><option value="CLEAR">未禁言</option></Select>
        </label>
        <label className="space-y-1.5 text-sm font-medium text-foreground">排序
          <Select aria-label="排序" value={sort} onChange={event => {setSort(event.target.value); setPage(1);}}><option value="NEWEST">最新注册</option><option value="OLDEST">最早注册</option><option value="ACTIVE">最近活动</option></Select>
        </label>
        <label className="space-y-1.5 text-sm font-medium text-foreground">注册起始日（UTC）
          <Input type="date" aria-label="注册起始日" max={registered?.until || undefined} value={registered?.from ?? ''} onChange={event => {setRegistered(current => ({from: event.target.value, until: current?.until ?? ''})); setPage(1);}} />
        </label>
        <label className="space-y-1.5 text-sm font-medium text-foreground">注册截止日（UTC）
          <Input type="date" aria-label="注册截止日" min={registered?.from || undefined} value={registered?.until ?? ''} onChange={event => {setRegistered(current => ({from: current?.from ?? '', until: event.target.value})); setPage(1);}} />
        </label>
        <div className="flex flex-wrap gap-3 sm:col-span-2 xl:col-span-5">
          <Button type="submit" leadingIcon={<Search className="h-4 w-4" />} disabled={reading || busy}>搜索用户</Button>
          <Button type="button" variant="outline" leadingIcon={<RefreshCw className="h-4 w-4" />} disabled={reading || busy} onClick={() => setRefresh(value => value + 1)}>刷新</Button>
        </div>
      </form>
    </AdminPanel>
    {reading && <AdminNotice tone="loading" title="正在查询用户…" />}
    {list && (
      <AdminPanel title="用户列表" description="点击任意行打开右侧详情；列表保留关键状态，完整资料与业务关联在详情中查看。" badge={<Badge variant="outline">{list.total} 人</Badge>}>
        <AccountTable
          items={list.items}
          selected={selected}
          loading={reading}
          pagination={{ page, pageCount: Math.max(1, Math.ceil(list.total / list.pageSize)), onPageChange: value => setPage(value), summary: `共 ${list.total} 人` }}
          canReadFinance={permissions.includes('finance.read')}
          onSelect={id => { if (busy || (detailDirty && !window.confirm('当前用户详情有未保存修改，切换用户会丢失这些输入。确定继续吗？'))) return; setSelected(id); setDetailDirty(false); setMessage(''); setError(''); }}
        />
      </AdminPanel>
    )}
    <DetailDrawer
      open={Boolean(selected)}
      onClose={closeDetail}
      title={detail ? `用户详情 · @${detail.user.username}` : '用户详情'}
      description={detail ? `用户编号 ${detail.user.id}` : '正在读取用户资料与关联资产'}
      size="xl"
    >
      {detailLoading && <AdminNotice tone="loading" title="正在读取用户详情…" className={detail ? 'mb-4 py-3' : undefined} />}
      {error && detail && <AdminNotice tone="error" title={error} className="mb-4 py-3" />}
      {message && detail && <AdminNotice tone="success" title={message} className="mb-4 py-3" />}
      {detailError && <AdminNotice tone="error" title={detailError} action={<Button variant="outline" onClick={() => setRefresh(value => value + 1)}>重试读取详情</Button>} />}
      {!detailLoading && !detailError && !detail && <AdminNotice tone="error" title="用户详情暂时为空，请重试。" action={<Button variant="outline" onClick={() => setRefresh(value => value + 1)}>重试读取详情</Button>} />}
      {detail && <ManagedAccountDetail key={detail.user.id} detail={detail} sessionActive={sessionActive} permissions={permissions} busy={busy} onAction={applyAction} onProfileSaved={() => setRefresh(value => value + 1)} onDirtyChange={setDetailDirty} onClose={closeDetail} />}
    </DetailDrawer>
  </AdminPage>;
}
