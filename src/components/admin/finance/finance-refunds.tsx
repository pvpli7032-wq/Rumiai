'use client';

import { Search, RotateCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { AdminNotice, AdminPanel } from '@/components/admin/admin-page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

type Refund = { refundNo: string; status: string; amountCnyCents: number; coinAmount: number; errorCode: string | null; createdAt: string; completedAt: string | null; requestedByMe: boolean; reason: string; approvedAt: string | null; approvalReason: string | null; rejectedAt: string | null; rejectionReason: string | null };
type Order = { orderNo: string; status: string; provider: string; providerTradeNo: string | null; amountCnyCents: number; coinAmount: number; paidAt: string | null; refund: Refund | null };
type Action = 'request' | 'approve' | 'reject' | 'retry' | 'verify';

const states: Record<string, string> = { PAID: '已付款', REFUND_PENDING: '退款处理中', REFUNDED: '已退款', PENDING_APPROVAL: '待审批', REJECTED: '审批驳回', PROCESSING: '渠道处理中', UNKNOWN: '结果待核对', SUCCEEDED: '退款成功', FAILED: '渠道明确拒绝' };

function actionAllowed(action: Action, canRequest: boolean, canApprove: boolean, canExecute: boolean) {
  if (action === 'request') return canRequest;
  if (action === 'approve' || action === 'reject') return canApprove;
  return canExecute;
}

function confirmText(action: Action, order: Order) {
  const amount = `¥${(order.amountCnyCents / 100).toFixed(2)}`;
  if (action === 'request') return `申请整单退款 ${amount}，将暂扣账号余额中的 ${order.coinAmount} 枚金币，等待另一位管理员审批。`;
  if (action === 'approve') return `批准退款 ${amount} 并提交到支付渠道？`;
  if (action === 'reject') return '驳回退款申请并释放已暂扣金币？';
  return null;
}

export function FinanceRefunds({ token, canRequest, canApprove, canExecute }: { token: string; canRequest: boolean; canApprove: boolean; canExecute: boolean }) {
  const [orders, setOrders] = useState<Order[]>([]), [reason, setReason] = useState(''), [lookup, setLookup] = useState(''), [busy, setBusy] = useState(''), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [pending, setPending] = useState<{ order: Order; action: Action; text: string } | null>(null);
  const load = useCallback(async (orderNo = '') => {
    setError('');
    try {
      const query = orderNo ? `?orderNo=${encodeURIComponent(orderNo)}` : '';
      const r = await fetch(`/api/admin/finance/orders${query}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setOrders(d);
    } catch (e) { setError((e as Error).message); setOrders([]); }
  }, [token]);
  useEffect(() => { void load(); }, [load]);

  async function act(order: Order, action: Action) {
    setPending(null);
    setBusy(order.orderNo); setError(''); setMessage('');
    try {
      const r = await fetch(`/api/admin/finance/orders/${order.orderNo}/refund`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action, reason: reason.trim() || (action === 'retry' ? '按原退款单号重试' : '') }) });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setMessage(`${order.orderNo}：${states[d.status] || d.status}${d.errorCode ? `（${d.errorCode}）` : ''}`);
      await load(lookup.trim());
    } catch (e) { await load(lookup.trim()); setError((e as Error).message); } finally { setBusy(''); }
  }

  function start(order: Order, action: Action) {
    if (busy || !actionAllowed(action, canRequest, canApprove, canExecute)) return;
    const text = confirmText(action, order);
    if (text) setPending({ order, action, text }); else void act(order, action);
  }

  return (
    <>
      <AdminPanel title="退款申请与复核" description="申请时暂扣充值金币；另一位管理员批准后才会联系渠道。驳回会释放金币。渠道明确拒绝同样返还；超时或状态无法确认时继续冻结，请先查单再用同一退款单号重试。">
      <div className="space-y-4">
        {(canRequest || canApprove) && (
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">申请 / 审批 / 驳回理由</span>
            <Textarea rows={3} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} />
          </label>
        )}
        <form className="flex flex-wrap items-center gap-2" onSubmit={e => { e.preventDefault(); void load(lookup.trim()); }}>
          <Input aria-label="按订单号查找" maxLength={40} value={lookup} onChange={e => setLookup(e.target.value)} placeholder="输入订单号查找历史订单" className="max-w-xs" />
          <Button type="submit" variant="outline" leadingIcon={<Search className="h-4 w-4" />} disabled={!!busy}>查找</Button>
          <Button type="button" variant="ghost" leadingIcon={<RotateCw className="h-4 w-4" />} disabled={!!busy} onClick={() => { setLookup(''); void load(); }}>刷新最近订单</Button>
        </form>
        {error && <AdminNotice tone="error" title={error} />}
        {message && <AdminNotice tone="success" title={message} />}
        {!orders.length && !error && <AdminNotice tone="info" title="暂无可退款订单。" />}
        <div className="space-y-3">
          {orders.map(order => (
            <article key={order.orderNo} className="space-y-3 rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="break-all font-medium">{order.orderNo}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{states[order.status] || order.status}</Badge>
                  <Badge variant={order.refund ? 'warning' : 'success'}>退款：{order.refund ? states[order.refund.status] || order.refund.status : '未申请'}</Badge>
                </div>
              </div>
              <p className="text-sm tabular-nums text-muted-foreground">¥{(order.amountCnyCents / 100).toFixed(2)} · {order.coinAmount} 枚金币</p>
              {order.refund && <p className="text-sm text-muted-foreground">申请理由：{order.refund.reason} · {new Date(order.refund.createdAt).toLocaleString('zh-CN')}</p>}
              {order.refund?.approvedAt && <p className="text-sm text-muted-foreground">已由另一位管理员审批 · {order.refund.approvalReason || ''} · {new Date(order.refund.approvedAt).toLocaleString('zh-CN')}</p>}
              {order.refund?.rejectionReason && <p className="text-sm">驳回原因：{order.refund.rejectionReason}</p>}
              {order.refund?.errorCode && <p className="text-sm">核对码：{order.refund.errorCode}</p>}
              <div className="flex flex-wrap gap-2">
                {canRequest && !order.refund && <Button loading={busy === order.orderNo} disabled={!!busy || !reason.trim()} onClick={() => start(order, 'request')}>{busy === order.orderNo ? '提交中…' : '申请整单退款'}</Button>}
                {canApprove && order.refund?.status === 'PENDING_APPROVAL' && !order.refund.requestedByMe && (
                  <>
                    <Button loading={busy === order.orderNo} disabled={!!busy || !reason.trim()} onClick={() => start(order, 'approve')}>{busy === order.orderNo ? '处理中…' : '批准并提交渠道'}</Button>
                    <Button variant="outline" disabled={!!busy || !reason.trim()} onClick={() => start(order, 'reject')}>驳回申请</Button>
                  </>
                )}
                {canExecute && order.refund && ['UNKNOWN', 'PROCESSING'].includes(order.refund.status) && (
                  <>
                    <Button variant="outline" disabled={!!busy} onClick={() => start(order, 'verify')}>查询退款状态</Button>
                    <Button variant="outline" disabled={!!busy} onClick={() => start(order, 'retry')}>同退款单号重试</Button>
                  </>
                )}
              </div>
            </article>
          ))}
        </div>
      </div>
      </AdminPanel>
      <Dialog
        open={!!pending}
        onClose={() => setPending(null)}
        title="确认退款操作"
        description={pending?.text}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPending(null)}>取消</Button>
            <Button variant="danger" disabled={!!busy} onClick={() => pending && void act(pending.order, pending.action)}>确认执行</Button>
          </>
        }
      />
    </>
  );
}
