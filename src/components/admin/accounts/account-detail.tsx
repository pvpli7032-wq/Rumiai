'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';
import type { AdminPermission } from '@/lib/admin/permissions';
import { AdminStat, AdminStatGrid, AdminPanel } from '../admin-page';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Select } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { apiFetch } from '@/lib/api-client';
import { AccountQuotaTab } from './account-quota-tab';
import { accountState, formatTime, actionLabels, auditLabels, type AccountAction, type AccountDetail } from './types';

function RelatedPanel({ title, empty, children }: { title: string; empty: string; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
      <p className="text-xs text-muted-foreground">{empty}</p>
    </div>
  );
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-border p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-all text-sm">{value}</dd>
    </div>
  );
}

/**
 * 用户详情（V3 §15）：默认只看头像、昵称、状态与余额；额度特例放单独标签，
 * 默认「继承公共值」。只改一个用户时不用跳到全局特例列表。
 */
export function ManagedAccountDetail({ detail, sessionActive, permissions, busy, onAction, onProfileSaved, onClose }: { detail: AccountDetail; sessionActive: boolean; permissions: AdminPermission[]; busy: boolean; onAction: (action: AccountAction, reason: string) => Promise<boolean>; onProfileSaved: () => void; onClose: () => void }) {
  const { user } = detail;
  const [reason, setReason] = useState('');
  const [profileReason, setProfileReason] = useState('');
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [profileMessage, setProfileMessage] = useState('');
  const [profile, setProfile] = useState({username: user.username, displayName: user.displayName ?? '', avatarUrl: user.avatarUrl ?? ''});
  const [confirming, setConfirming] = useState<AccountAction | null>(null);
  const [tab, setTab] = useState('basic');
  const actions: AccountAction[] = user.deletedAt ? [] : [...(permissions.includes('accounts.manage') ? [user.suspendedAt ? 'RESTORE' as const : 'SUSPEND' as const] : []), ...(permissions.includes('accounts.community.manage') ? [user.communityBannedAt ? 'UNBAN_COMMUNITY' as const : 'BAN_COMMUNITY' as const] : []), ...(permissions.includes('accounts.sessions.revoke') ? ['REVOKE_SESSIONS' as const] : [])];
  const [action, setAction] = useState<AccountAction | ''>(actions[0] ?? '');
  const selectedAction = actions.includes(action as AccountAction) ? action as AccountAction : actions[0];
  async function run(target: AccountAction) {
    if (!busy && await onAction(target, reason)) { setReason(''); setConfirming(null); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!selectedAction || busy) return;
    if (selectedAction === 'SUSPEND' || selectedAction === 'REVOKE_SESSIONS') { setConfirming(selectedAction); return; }
    await run(selectedAction);
  }
  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    if (profileBusy || !sessionActive || user.deletedAt) return;
    setProfileBusy(true); setProfileError(''); setProfileMessage('');
    try {
      await apiFetch(`/api/admin/accounts/${encodeURIComponent(user.id)}/profile`, {method: 'PATCH', credentials: 'same-origin', body: {...profile, avatarUrl: profile.avatarUrl || null, reason: profileReason, version: user.accountVersion}});
      setProfileReason(''); setProfileMessage('用户资料已保存，前台关联数据会按新资料读取。'); onProfileSaved();
    } catch (error) { setProfileError(error instanceof Error ? error.message : '用户资料保存失败。'); }
    finally { setProfileBusy(false); }
  }
  const displayName = user.displayName?.trim() || user.username;

  return (
    <AdminPanel
      aria-label="用户详情"
      title={`用户详情 · @${user.username}`}
      description={`用户编号 ${user.id}`}
      badge={<Badge variant={user.deletedAt ? 'neutral' : user.suspendedAt ? 'danger' : 'success'}>{accountState(user)}</Badge>}
      actions={<Button variant="ghost" size="sm" leadingIcon={<X className="h-4 w-4" />} disabled={busy} onClick={onClose}>关闭详情</Button>}
    >
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label="用户详情标签">
          <TabsTrigger value="basic">基本资料</TabsTrigger>
          <TabsTrigger value="quota">额度特例</TabsTrigger>
        </TabsList>

        <TabsContent value="basic" className="space-y-5">
          <div className="flex flex-wrap items-center gap-4">
            <Avatar src={user.avatarUrl} name={displayName} alt={displayName} size="lg" />
            <div className="min-w-0">
              <p className="truncate text-base font-semibold">{displayName}</p>
              <p className="truncate text-sm text-muted-foreground">@{user.username}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant={user.deletedAt ? 'neutral' : user.suspendedAt ? 'danger' : 'success'}>{accountState(user)}</Badge>
              {user.communityBannedAt && <Badge variant="warning">社区禁言中</Badge>}
              <Badge variant="brand">{user.coins} 金币</Badge>
            </div>
          </div>

          <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Field label="昵称" value={user.displayName?.trim() || '未设置'} />
            <Field label="登录邮箱" value={user.email} />
            <Field label="社区权限" value={user.communityBannedAt ? '已禁言' : '可发言'} />
            <Field label="金币余额" value={String(user.coins)} />
            <Field label="注册时间" value={formatTime(user.createdAt)} />
            <Field label="最近登录" value={formatTime(user.lastLoginAt)} />
            <Field label="最近认证活动" value={formatTime(user.lastActiveAt)} />
          </dl>
          {!user.deletedAt && permissions.includes('accounts.manage') && (
            <form onSubmit={saveProfile} className="space-y-4 rounded-lg border border-border bg-muted/30 p-4">
              <div>
                <h3 className="text-sm font-semibold">修改公开资料</h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">可修改用户名、昵称和头像。本页不提供邮箱改绑、等级调整或余额调整。</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-1.5 text-sm font-medium">用户名
                  <Input required maxLength={100} value={profile.username} onChange={event => setProfile(current => ({...current, username: event.target.value}))} />
                </label>
                <label className="space-y-1.5 text-sm font-medium">昵称
                  <Input required maxLength={100} value={profile.displayName} onChange={event => setProfile(current => ({...current, displayName: event.target.value}))} />
                </label>
                <label className="space-y-1.5 text-sm font-medium sm:col-span-2">头像地址
                  <Input maxLength={2048} value={profile.avatarUrl} onChange={event => setProfile(current => ({...current, avatarUrl: event.target.value}))} placeholder="/brand/icon.svg、/uploads/... 或 HTTPS 图片地址" />
                </label>
                <label className="space-y-1.5 text-sm font-medium sm:col-span-2">操作理由
                  <Textarea required maxLength={300} rows={2} value={profileReason} onChange={event => setProfileReason(event.target.value)} placeholder="说明为什么需要修改资料" />
                </label>
              </div>
              {profileError && <p role="alert" className="text-sm text-destructive">{profileError}</p>}
              {profileMessage && <p role="status" className="text-sm text-emerald-600">{profileMessage}</p>}
              <Button type="submit" loading={profileBusy} disabled={profileBusy || !profileReason.trim()}>保存公开资料</Button>
            </form>
          )}
          {user.suspensionReason && <p className="break-words rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">停用理由：{user.suspensionReason}</p>}
          {user.communityBanReason && <p className="break-words rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">禁言理由：{user.communityBanReason}</p>}
          <AdminStatGrid className="sm:grid-cols-2 xl:grid-cols-4">
            <AdminStat label="角色" value={user._count.characters} />
            <AdminStat label="会话" value={user._count.conversations} />
            <AdminStat label="帖子" value={user._count.posts} />
            <AdminStat label="订单" value={user._count.paymentOrders} />
          </AdminStatGrid>
          {!!actions.length && (
            <form onSubmit={submit} className="space-y-4 rounded-lg border border-border bg-muted/30 p-4">
              <div>
                <h3 className="text-sm font-semibold">账号操作</h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">社区禁言保留登录、阅读及申诉；停用网站账号会阻止登录。恢复后须重新登录。</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium">操作类型</span>
                  <Select aria-label="操作类型" value={selectedAction} onChange={event => setAction(event.target.value as AccountAction)}>
                    {actions.map(item => <option value={item} key={item}>{actionLabels[item]}</option>)}
                  </Select>
                </label>
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium">操作理由</span>
                  <Textarea required maxLength={500} rows={3} value={reason} onChange={event => setReason(event.target.value)} />
                </label>
              </div>
              <Button type="submit" variant="danger" loading={busy} disabled={busy || !reason.trim()}>{busy ? '处理中…' : '执行账号操作'}</Button>
            </form>
          )}
          <div className="grid gap-5 xl:grid-cols-2">
            <RelatedPanel title="近期角色" empty={detail.characters.length ? '' : '暂无角色。'}>
              {detail.characters.map(item => (
                <p key={item.id} className="break-all border-b border-border py-2 text-sm">{item.name} · {item.reviewStatus} · {item.isPublic ? '公开' : '私有'}<span className="mt-1 block text-xs text-muted-foreground">{item.id}</span></p>
              ))}
            </RelatedPanel>
            <RelatedPanel title="近期订单" empty={detail.orders.length ? '' : '暂无订单。'}>
              {detail.orders.map(item => (
                <p key={item.orderNo} className="break-all border-b border-border py-2 text-sm">{item.orderNo} · {item.status} · ¥{(item.amountCnyCents / 100).toFixed(2)} · {item.coinAmount} 金币</p>
              ))}
            </RelatedPanel>
          </div>
          {detail.canReadFinance && (
            <RelatedPanel title="近期金币流水" empty={detail.ledger?.length ? '' : '暂无流水。'}>
              {detail.ledger?.map(item => <p key={item.id} className="break-all border-b border-border py-2 text-sm">{formatTime(item.createdAt)} · {item.type} · {item.amount > 0 ? '+' : ''}{item.amount}</p>)}
            </RelatedPanel>
          )}
          <RelatedPanel title="近期账号操作记录" empty={detail.activity.length ? '' : '暂无操作记录。'}>
            {detail.activity.map(item => (
              <article key={item.id} className="space-y-1 break-words border-b border-border py-2 text-sm">
                <p>{formatTime(item.createdAt)} · {auditLabels[item.action] ?? item.action}</p>
                <p>{item.reason}</p>
                <p className="break-all text-xs text-muted-foreground">操作人：{item.actorId}</p>
              </article>
            ))}
          </RelatedPanel>
          <p className="text-xs text-muted-foreground">关联列表各显示最近 {detail.relatedLimit} 条。活动时间自本功能启用后记录，最多每五分钟更新一次。</p>
        </TabsContent>

        <TabsContent value="quota">
          <AccountQuotaTab userId={user.id} sessionActive={sessionActive} permissions={permissions} />
        </TabsContent>
      </Tabs>

      <Dialog
        open={!!confirming}
        onClose={() => setConfirming(null)}
        title="确认账号操作"
        description={confirming ? `确认对 @${user.username} 执行「${actionLabels[confirming]}」？现有登录会话将失效。` : undefined}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(null)}>取消</Button>
            <Button variant="danger" disabled={busy} onClick={() => confirming && void run(confirming)}>确认执行</Button>
          </>
        }
      />
    </AdminPanel>
  );
}
