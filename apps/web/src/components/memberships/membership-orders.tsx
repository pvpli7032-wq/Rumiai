'use client';

import type {MembershipOrderPublic} from '@rumiai/contracts/memberships';
import {Button} from '@rumiai/ui/button';
import {formatDateTime} from '@rumiai/contracts/format/date-time';

const labels:Record<string,string>={PENDING:'待支付',PAID:'已支付',REFUNDED:'已退款',CANCELLED:'已取消'};
const refundLabels:Record<string,string>={PENDING:'退款结果待确认',COMPLETED:'退款已完成',FAILED:'退款被渠道拒绝，权益已恢复'};
export function MembershipOrders({orders,busy,onRefund}:{orders:MembershipOrderPublic[];busy:string|null;onRefund:(orderNo:string)=>void}) {
  if(!orders.length)return null;
  return <section className="rounded-xl border border-border bg-card p-5">
    <h2 className="font-semibold">购买与续费记录</h2>
    <div className="mt-4 divide-y divide-border">{orders.map(order=><div key={order.orderNo} className="flex flex-wrap items-center justify-between gap-3 py-4 text-sm">
      <div className="min-w-0 space-y-1">
        <p className="font-medium">{order.planName} · ¥{(order.amountCents/100).toFixed(2)}</p>
        <p className="text-xs text-muted-foreground">{labels[order.status]??order.status} · {formatDateTime(order.paidAt??order.createdAt)}</p>
        {order.grant&&<p className="text-xs text-muted-foreground">本次有效期：{formatDateTime(order.grant.startsAt)} — {formatDateTime(order.grant.expiresAt)}{order.grant.status==='REVOKED'?'（已撤销）':''}</p>}
        {order.refund&&<p className="text-xs text-muted-foreground">{refundLabels[order.refund.status]??order.refund.status} · 退款 ¥{(order.refund.amountCents/100).toFixed(2)}，扣费 ¥{(order.refund.deductedCents/100).toFixed(2)}</p>}
      </div>
      {order.status==='PAID'&&order.refund?.status!=='COMPLETED'&&<Button size="sm" variant="outline" disabled={busy!==null} onClick={()=>onRefund(order.orderNo)}>
        {busy===order.orderNo?'处理中…':order.refund?.status==='PENDING'?'重试确认退款':order.refund?.status==='FAILED'?'重新申请退款':'查看退款金额'}
      </Button>}
    </div>)}</div>
  </section>;
}
