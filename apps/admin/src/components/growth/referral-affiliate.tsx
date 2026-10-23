'use client';
import {useEffect, useState} from 'react';
import Link from 'next/link';
import {API} from '@rumiai/contracts/api-paths';
import {AdminNotice, AdminPanel} from '@admin/components/admin-page';
import {Button} from '@rumiai/ui/button';
import {Input} from '@rumiai/ui/input';

type Relation = {id: string; boundAt: string; inviter: {username: string; email: string}; invitee: {username: string; email: string}; inviteCode: {code: string}};
type Ledger = {id: string; sourceType: string; sourceOrderId: string; commissionCents: number; reversedCents: number; status: string; beneficiary: {username: string}; referredUser: {username: string}; createdAt: string};
type Payload = {relations: {items: Relation[]; total: number}; affiliate: {policy: {enabled: boolean; commissionPercent: number | null; eligibleOrderTypes: string[]; settlementDelayHours: number | null; minimumWithdrawalCents: number | null}; ledger: {items: Ledger[]; total: number}}};

export function ReferralAffiliateManagement({sessionActive}: {sessionActive: boolean}) {
  const [payload, setPayload] = useState<Payload | null>(null), [error, setError] = useState(''), [q, setQ] = useState(''), [query, setQuery] = useState('');
  useEffect(() => {if (!sessionActive) return; const controller = new AbortController(); setError(''); Promise.all([fetch(`${API.admin.growth.referrals}?q=${encodeURIComponent(query)}`, {credentials: 'include', cache: 'no-store', signal: controller.signal}).then(async response => response.ok ? response.json() : Promise.reject(Error((await response.json()).error))), fetch(API.admin.growth.affiliate, {credentials: 'include', cache: 'no-store', signal: controller.signal}).then(async response => response.ok ? response.json() : Promise.reject(Error((await response.json()).error)))]).then(([relations, affiliate]) => {if (!controller.signal.aborted) setPayload({relations, affiliate});}).catch(cause => {if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '邀请与分销数据读取失败。');}); return () => controller.abort();}, [sessionActive, query]);
  if (error) return <AdminNotice tone="error" title={error} />; if (!payload) return <AdminNotice tone="loading" title="正在读取邀请关系与佣金账本…" />;
  const p = payload.affiliate.policy;
  return <div className="space-y-4">
    <AdminPanel title="一级分销状态" description="唯一编辑入口在公共设置；这里仅展示实际生效口径与订单快照账本。">
      <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-5"><span>状态：{p.enabled ? '已启用' : '已关闭'}</span><span>直接佣金：{p.commissionPercent === null ? '未配置' : `${p.commissionPercent}%`}</span><span>订单：{p.eligibleOrderTypes.join('、') || '未配置'}</span><span>等待：{p.settlementDelayHours === null ? '未配置' : `${p.settlementDelayHours} 小时`}</span><span>最低处理：{p.minimumWithdrawalCents === null ? '未配置' : `¥${(p.minimumWithdrawalCents / 100).toFixed(2)}`}</span></div>
      <Link className="mt-3 inline-flex min-h-9 items-center rounded-md border border-border px-3 text-sm font-medium hover:bg-muted" href="/admin/settings?tab=growth&section=growth-affiliate">前往公共设置</Link>
    </AdminPanel>
    <AdminPanel title={`上下级关系（${payload.relations.total}）`} description="只展示直接上级与直接下级，不计算间接层级。"><form className="mb-3 flex gap-2" onSubmit={event => {event.preventDefault(); setQuery(q);}}><Input value={q} onChange={event => setQ(event.target.value)} placeholder="搜索上下级用户名或邮箱" /><Button type="submit">查询</Button></form><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">上级</th><th className="p-2">下级</th><th className="p-2">邀请码</th><th className="p-2">绑定时间</th></tr></thead><tbody>{payload.relations.items.map(item => <tr key={item.id} className="border-t border-border"><td className="p-2">@{item.inviter.username}</td><td className="p-2">@{item.invitee.username}</td><td className="p-2 font-mono">{item.inviteCode.code}</td><td className="p-2">{new Date(item.boundAt).toLocaleString('zh-CN')}</td></tr>)}</tbody></table></div></AdminPanel>
    <AdminPanel title={`佣金账本（${payload.affiliate.ledger.total}）`} description="PENDING/AVAILABLE/PROCESSED 为结算状态；退款产生冲回金额，不改原订单快照。"><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">直接上级</th><th className="p-2">下级</th><th className="p-2">订单</th><th className="p-2">佣金/冲回</th><th className="p-2">状态</th></tr></thead><tbody>{payload.affiliate.ledger.items.map(item => <tr key={item.id} className="border-t border-border"><td className="p-2">@{item.beneficiary.username}</td><td className="p-2">@{item.referredUser.username}</td><td className="p-2">{item.sourceType} · {item.sourceOrderId}</td><td className="p-2">¥{(item.commissionCents / 100).toFixed(2)} / -¥{(item.reversedCents / 100).toFixed(2)}</td><td className="p-2">{item.status}</td></tr>)}</tbody></table></div></AdminPanel>
  </div>;
}
