import { useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import type { AdminPermission } from '@/lib/admin/permissions';
import { AdminStat, AdminStatGrid, AdminPanel } from '../admin-page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { accountState, formatTime, actionLabels, auditLabels, type AccountAction, type AccountDetail } from './types';

function RelatedPanel({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
      <p className="text-xs text-muted-foreground">{empty}</p>
    </div>
  );
}

export function ManagedAccountDetail({ detail, permissions, busy, onAction, onClose }: { detail: AccountDetail; permissions: AdminPermission[]; busy: boolean; onAction: (action: AccountAction, reason: string) => Promise<boolean>; onClose: () => void }) {
  const { user } = detail;
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState<AccountAction | null>(null);
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
  return (
    <AdminPanel
      aria-label="用户详情"
      title={`用户详情 · @${user.username}`}
      description={`用户编号 ${user.id}`}
      badge={<Badge variant={user.deletedAt ? 'neutral' : user.suspendedAt ? 'danger' : 'success'}>{accountState(user)}</Badge>}
      actions={<Button variant="ghost" size="sm" leadingIcon={<X className="h-4 w-4" />} disabled={busy} onClick={onClose}>关闭详情</Button>}
    >
      <div className="space-y-5">
        <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[['登录邮箱', user.email], ['社区权限', user.communityBannedAt ? '已禁言' : '可发言'], ['金币余额', String(user.coins)], ['注册时间', formatTime(user.createdAt)], ['最近登录', formatTime(user.lastLoginAt)], ['最近认证活动', formatTime(user.lastActiveAt)]].map(([label, value]) => (
            <div key={label} className="min-w-0 rounded-lg border border-border p-3">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="mt-1 break-all text-sm">{value}</dd>
            </div>
          ))}
        </dl>
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
      </div>
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
