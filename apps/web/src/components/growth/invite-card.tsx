'use client';

import {useEffect, useState} from 'react';
import {Copy, Gift} from 'lucide-react';
import {api, ApiError} from '@web/lib/api-client';
import {API} from '@rumiai/contracts/api-paths';
import {useAuth} from '@web/lib/auth-context';
import {Button, Card, EmptyState, ErrorState, Skeleton} from '@rumiai/ui';
import type {InvitePayload, ReferralPayload} from './types';

export function InviteCard() {
  const {token} = useAuth();
  const [payload, setPayload] = useState<InvitePayload | null>(null);
  const [referrals, setReferrals] = useState<ReferralPayload | null>(null);
  const [expiresAt, setExpiresAt] = useState(''), [maxUses, setMaxUses] = useState(''), [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [reloadToken, setReloadToken] = useState(0);
  const [copyState, setCopyState] = useState<'code' | 'link' | 'failed' | null>(null);

  useEffect(() => {
    setPayload(null);setReferrals(null);
    if (!token) return;
    const controller = new AbortController();
    setPayload(null);
    setLoadError('');
    Promise.all([api.get<InvitePayload>(API.growth.invite, {token, signal: controller.signal}), api.get<ReferralPayload>(API.growth.referrals, {token, signal: controller.signal})])
      .then(([data, relations]) => {
        if (!controller.signal.aborted) {setPayload(data); setReferrals(relations); setExpiresAt(relations.code.expiresAt?.slice(0, 10) ?? ''); setMaxUses(relations.code.maxUses?.toString() ?? '');}
      })
      .catch(cause => {
        if (controller.signal.aborted) return;
        setLoadError(cause instanceof ApiError ? cause.message : '邀请信息加载失败，请稍后重试。');
      });
    return () => controller.abort();
  }, [token, reloadToken]);

  async function copy(kind: 'code' | 'link', text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopyState(kind);
    } catch {
      setCopyState('failed');
    }
  }
  async function saveInvite(enabled: boolean) {
    if (!referrals || saving) return; setSaving(true); setLoadError('');
    try {
      const code = await api.patch<ReferralPayload['code']>(API.growth.referrals, {id: referrals.code.id, version: referrals.code.version, enabled, expiresAt: expiresAt ? new Date(`${expiresAt}T23:59:59.999Z`).toISOString() : null, maxUses: maxUses ? Number(maxUses) : null}, {token});
      setReferrals(current => current ? {...current, code} : current);
      setExpiresAt(code.expiresAt?.slice(0, 10) ?? '');
      setMaxUses(code.maxUses?.toString() ?? '');
    }
    catch (cause) {setLoadError(cause instanceof ApiError ? cause.message : '邀请码更新失败。');} finally {setSaving(false);}
  }

  if (!token) return null;

  if (loadError) {
    return (
      <Card>
        <div className="p-4">
          <ErrorState
            title="邀请信息加载失败"
            description={loadError}
            action={
              <Button variant="outline" size="sm" onClick={() => setReloadToken(value => value + 1)}>
                重试
              </Button>
            }
          />
        </div>
      </Card>
    );
  }

  if (!payload) {
    return (
      <Card>
        <div className="space-y-2 p-4">
          <Skeleton shape="text" className="w-24" />
          <Skeleton className="h-10" />
        </div>
      </Card>
    );
  }

  // 开关关闭：不展示入口，连卡片都不出现。
  if (!payload.enabled) return null;

  return (
    <Card>
      <div className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <Gift aria-hidden className="h-4 w-4 text-brand" />
          <h2 className="text-sm font-semibold text-foreground">邀请好友</h2>
        </div>
        {payload.code || payload.link ? (
          <>
            {payload.code && (
              <div className="flex items-center gap-2 rounded-lg border border-border p-2">
                <span className="min-w-0 flex-1 truncate font-mono text-sm text-foreground">{payload.code}</span>
                <Button variant="outline" size="sm" leadingIcon={<Copy aria-hidden className="h-3.5 w-3.5" />} onClick={() => void copy('code', payload.code ?? '')}>
                  复制邀请码
                </Button>
              </div>
            )}
            {payload.link && (
              <div className="flex items-center gap-2 rounded-lg border border-border p-2">
                <span className="min-w-0 flex-1 break-all text-xs text-muted-foreground">{payload.link}</span>
                <Button variant="outline" size="sm" leadingIcon={<Copy aria-hidden className="h-3.5 w-3.5" />} onClick={() => void copy('link', payload.link ?? '')}>
                  复制链接
                </Button>
              </div>
            )}
            {payload.rewardCoins > 0 && (
              <p className="text-xs leading-5 text-muted-foreground">
                好友通过你的邀请注册并完成首次聊天后，你获得 {payload.rewardCoins} 金币。
              </p>
            )}
            {referrals && <details className="rounded-lg border border-border"><summary className="cursor-pointer p-3 text-sm">邀请记录与管理</summary><div className="space-y-3 border-t border-border p-3">
              <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs text-muted-foreground">有效截止日（UTC，可留空）<input className="mt-1 block h-9 w-full rounded-md border border-border bg-background px-2 text-sm" type="date" value={expiresAt} onChange={event => setExpiresAt(event.target.value)} /></label><label className="text-xs text-muted-foreground">最多使用次数（可留空）<input className="mt-1 block h-9 w-full rounded-md border border-border bg-background px-2 text-sm" type="number" min={Math.max(1, referrals.code.usedCount)} value={maxUses} onChange={event => setMaxUses(event.target.value)} /></label></div>
              <p className="text-xs text-muted-foreground">已使用 {referrals.code.usedCount}{referrals.code.maxUses === null ? ' 次（不限总次数）' : ` / ${referrals.code.maxUses} 次`}；状态：{referrals.code.status === 'ACTIVE' ? '启用' : '停用'}</p>
              <div className="flex gap-2"><Button size="sm" onClick={() => void saveInvite(true)} disabled={saving}>保存并启用</Button><Button size="sm" variant="outline" onClick={() => void saveInvite(false)} disabled={saving}>停用邀请码</Button></div>
              {referrals.parent && <p className="text-xs text-muted-foreground">我的直接上级：{referrals.parent.inviter.displayName || referrals.parent.inviter.username}</p>}
              <div><p className="text-xs font-medium">直接邀请用户（{referrals.totalChildren??referrals.children.length}）</p>{(referrals.totalChildren??0)>referrals.children.length&&<p className="mt-1 text-xs text-muted-foreground">当前显示最近 {referrals.children.length} 名直接邀请用户。</p>}{referrals.children.length ? <ul className="mt-1 space-y-1 text-xs text-muted-foreground">{referrals.children.map(item => <li key={item.invitee.id}>@{item.invitee.username} · {new Date(item.boundAt).toLocaleDateString('zh-CN')}</li>)}</ul> : <p className="mt-1 text-xs text-muted-foreground">还没有直接下级。</p>}</div>
              {referrals.rewards&&<p className="text-xs text-muted-foreground">邀请奖励：已入账 {referrals.rewards.coins} 金币，共 {referrals.rewards.events} 笔；金币可在流水中核对，不等同现金佣金。</p>}
              {Object.entries(referrals.commissionByCurrency??{}).map(([currency,summary])=><div key={currency} className="space-y-1 text-xs text-muted-foreground"><p className="font-medium text-foreground">佣金台账 · {currency}</p><p>待结算 {(summary.pendingCents/100).toFixed(2)} · 已达可结算时间 {(summary.availableCents/100).toFixed(2)}</p><p>已处理 {(summary.processedCents/100).toFixed(2)} · 退款冲回 {(summary.reversedCents/100).toFixed(2)}</p></div>)}
              <p className="text-xs text-muted-foreground">佣金与金币分开记账；当前未开放用户提现入口。没有佣金记录时不显示收益数值。</p>
            </div></details>}
            {copyState && (
              <p role="status" className="text-xs text-muted-foreground">
                {copyState === 'failed' ? '复制失败，请长按上面的内容手动复制。' : copyState === 'code' ? '邀请码已复制。' : '分享链接已复制。'}
              </p>
            )}
          </>
        ) : (
          <EmptyState title="邀请码暂未生成" description="稍后刷新本页再试。" />
        )}
      </div>
    </Card>
  );
}
