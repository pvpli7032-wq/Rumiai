'use client';
import { useCallback, useEffect, useState } from 'react';

type Refund = { refundNo: string; status: string; amountCnyCents: number; coinAmount: number; errorCode: string | null; createdAt: string; completedAt: string | null };
type Order = { orderNo: string; status: string; provider: string; providerTradeNo: string | null; amountCnyCents: number; coinAmount: number; paidAt: string | null; refund: Refund | null };
const states: Record<string, string> = { PAID: '已付款', REFUND_PENDING: '退款待核对', REFUNDED: '已退款', PROCESSING: '渠道处理中', UNKNOWN: '结果待核对', SUCCEEDED: '退款成功', FAILED: '渠道明确拒绝' };

export function FinanceRefunds({ token, canRefund }: { token: string; canRefund: boolean }) {
  const [orders, setOrders] = useState<Order[]>([]), [reason, setReason] = useState(''), [lookup, setLookup] = useState(''), [busy, setBusy] = useState(''), [error, setError] = useState(''), [message, setMessage] = useState('');
  const load = useCallback(async (orderNo = '') => { setError(''); try { const query = orderNo ? `?orderNo=${encodeURIComponent(orderNo)}` : ''; const r = await fetch(`/api/finance/orders${query}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }); const d = await r.json(); if (!r.ok) throw Error(d.error); setOrders(d); } catch (e) { setError((e as Error).message); setOrders([]); } }, [token]);
  useEffect(() => { void load(); }, [load]);
  async function act(order: Order, action: 'refund' | 'retry' | 'verify') {
    if (busy || !canRefund) return;
    if (action === 'refund' && !window.confirm(`确认整单退款 ¥${(order.amountCnyCents / 100).toFixed(2)}，并从账号余额扣留 ${order.coinAmount} 枚金币？`)) return;
    setBusy(order.orderNo); setError(''); setMessage('');
    try {
      const r = await fetch(`/api/finance/orders/${order.orderNo}/refund`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action, reason: reason.trim() || (action === 'retry' ? '按原退款单号重试' : '') }) });
      const d = await r.json(); if (!r.ok) throw Error(d.error); setMessage(`${order.orderNo}：${states[d.status] || d.status}${d.errorCode ? `（${d.errorCode}）` : ''}`); await load(lookup.trim());
    } catch (e) { await load(lookup.trim()); setError((e as Error).message); } finally { setBusy(''); }
  }
  return <section className="space-y-3 rounded-xl border p-4"><h2 className="font-bold">全额退款</h2>
    <p className="text-sm text-muted-foreground">仅整单退款。提交时先冻结订单金币；渠道明确拒绝会返还金币。超时或状态无法确认时保留冻结，请先查询渠道再用同一退款单号重试。</p>
    {canRefund && <label className="block text-sm">退款原因<textarea className="mt-1 min-h-20 w-full rounded-sm border bg-transparent p-2" maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></label>}
    <form className="flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); void load(lookup.trim()); }}><input className="min-h-11 min-w-48 flex-1 rounded-sm border bg-transparent px-3" aria-label="按订单号查找" maxLength={40} value={lookup} onChange={e => setLookup(e.target.value)} placeholder="输入订单号查找历史订单"/><button className="min-h-11 rounded-sm border px-4" disabled={!!busy}>查找</button><button type="button" className="min-h-11 rounded-sm border px-4" disabled={!!busy} onClick={() => { setLookup(''); void load(); }}>刷新最近订单</button></form>
    {error && <p role="alert" className="text-red-400">{error}</p>}{message && <p role="status">{message}</p>}
    {!orders.length && !error && <p>暂无可退款订单。</p>}
    {orders.map(order => <article key={order.orderNo} className="space-y-2 break-all border-t pt-3"><p className="font-medium">{order.orderNo} · {states[order.status] || order.status}</p><p>¥{(order.amountCnyCents / 100).toFixed(2)} · {order.coinAmount} 枚 · 退款：{order.refund ? states[order.refund.status] || order.refund.status : '未申请'}</p>{order.refund?.errorCode && <p className="text-sm">核对码：{order.refund.errorCode}</p>}<div className="flex flex-wrap gap-2">
      {canRefund && !order.refund && <button className="min-h-11 rounded-sm bg-orange-600 px-4 text-white disabled:opacity-50" disabled={!!busy || !reason.trim()} onClick={() => void act(order, 'refund')}>{busy === order.orderNo ? '处理中…' : '申请整单退款'}</button>}
      {canRefund && order.refund && ['UNKNOWN', 'PROCESSING'].includes(order.refund.status) && <><button className="min-h-11 rounded-sm border px-4" disabled={!!busy} onClick={() => void act(order, 'verify')}>查询退款状态</button><button className="min-h-11 rounded-sm border px-4" disabled={!!busy} onClick={() => void act(order, 'retry')}>同退款单号重试</button></>}
    </div></article>)}
  </section>;
}
