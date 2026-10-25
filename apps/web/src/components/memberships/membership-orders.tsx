'use client';

import {useEffect,useRef,useState} from 'react';
import {membershipApi} from './membership-api';
import type {MembershipOrderPublic,MembershipUsagePage} from '@rumiai/contracts/memberships';
import {Button} from '@rumiai/ui/button';
import {formatDateTime} from '@rumiai/contracts/format/date-time';

const labels:Record<string,string>={PENDING:'待支付',PAID:'已支付',REFUNDED:'已退款',CANCELLED:'已取消'};
const refundLabels:Record<string,string>={PENDING:'退款结果待确认',COMPLETED:'退款已完成',FAILED:'退款被渠道拒绝，权益已恢复'};
export function MembershipOrders({orders,busy,onRefund,token}:{orders:MembershipOrderPublic[];busy:string|null;onRefund:(orderNo:string)=>void;token:string|null}) {
  if(!orders.length)return null;
  return <section className="rounded-xl border border-border bg-card p-5">
    <h2 className="font-semibold">购买与续费记录</h2>
    <div className="mt-4 divide-y divide-border">{orders.map(order=><article key={order.orderNo} aria-label={`会员订单 ${order.orderNo}`} className="flex flex-wrap items-center justify-between gap-3 py-4 text-sm">
      <div className="min-w-0 space-y-1">
        <p className="font-medium">{order.planName} · ¥{(order.amountCents/100).toFixed(2)}</p>
        <p className="text-xs text-muted-foreground">{labels[order.status]??order.status} · {formatDateTime(order.paidAt??order.createdAt)}</p>
        {order.grant&&<p className="text-xs text-muted-foreground">本次有效期：{formatDateTime(order.grant.startsAt)} — {formatDateTime(order.grant.expiresAt)}{order.grant.status==='REVOKED'?'（已撤销）':''}</p>}
        {token&&<MembershipUsageDetails orderNo={order.orderNo} token={token}/>}
        {order.refund&&<p className={`text-xs ${order.refund.status==='FAILED'?'text-destructive':order.refund.status==='COMPLETED'?'text-foreground':'text-muted-foreground'}`}>{refundLabels[order.refund.status]??order.refund.status} · 退款 ¥{(order.refund.amountCents/100).toFixed(2)}，扣费 ¥{(order.refund.deductedCents/100).toFixed(2)}</p>}
      </div>
      {order.status==='PENDING'&&<p className="text-xs text-muted-foreground">等待支付确认；未确认前不会变更会员权益。</p>}
      {order.status==='PAID'&&order.refund?.status!=='COMPLETED'&&<Button size="sm" variant="outline" disabled={busy!==null} onClick={()=>onRefund(order.orderNo)}>
        {busy===order.orderNo?'处理中…':order.refund?.status==='PENDING'?'重试确认退款':order.refund?.status==='FAILED'?'重新申请退款':'查看退款金额'}
      </Button>}
    </article>)}</div>
  </section>;
}

function MembershipUsageDetails({orderNo,token}:{orderNo:string;token:string}) {
  const [open,setOpen]=useState(false),[page,setPage]=useState<MembershipUsagePage|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
  const request=useRef(0);
  useEffect(()=>()=>{request.current++;},[token,orderNo]);
  async function load(cursor:string|null=null) {
    const ticket=++request.current;setLoading(true);setError('');
    try {
      const data=await membershipApi.usage(token,orderNo,cursor);
      if(ticket!==request.current)return;
      setPage(previous=>cursor&&previous?{...data,items:[...previous.items,...data.items.filter(item=>!previous.items.some(existing=>existing.id===item.id))]}:data);
    }catch(cause){if(ticket===request.current)setError(cause instanceof Error?cause.message:'权益使用记录读取失败，请重试。');}
    finally{if(ticket===request.current)setLoading(false);}
  }
  const states:Record<string,string>={RESERVED:'处理中',CONSUMED:'已使用',RELEASED:'已释放'};
  return <section className="pt-2">
    <button type="button" aria-expanded={open} onClick={()=>{setOpen(value=>!value);if(!open&&!page)void load();}} className="min-h-11 text-sm underline">{open?'收起权益使用明细':'查看权益使用明细'}</button>
    {open&&<div className="mt-2 space-y-3 rounded-lg border border-border p-3">
      {page&&<p className="text-xs text-muted-foreground">累计权益用量：已用 {page.summary.consumed} · 处理中 {page.summary.reserved} · 已释放 {page.summary.released}。按权益项累计，不等于聊天条数或扣费金额。</p>}
      <p className="text-xs text-muted-foreground">处理中可能暂时影响退款申请；已释放不算已使用。实际可退金额以退款预估为准。</p>
      {page?.items.length===0&&<p className="text-sm text-muted-foreground">这笔订单暂无权益使用记录。</p>}
      {page&&<ul className="divide-y divide-border">{page.items.map(item=><li key={item.id} className="space-y-1 py-2"><p>{item.label} · 数量 {item.quantity} · {states[item.state]??item.state}</p><p className="text-xs text-muted-foreground">{formatDateTime(item.createdAt)} · {item.affectsRefund?'已计入权益使用判定':item.state==='RESERVED'?'等待最终结果':'不计入已使用'}</p></li>)}</ul>}
      {loading&&<p role="status" className="text-sm text-muted-foreground">正在读取使用明细…</p>}
      {error&&<p role="alert" className="text-sm text-destructive">{error}<button type="button" disabled={loading} onClick={()=>void load(page?.nextCursor??null)} className="ml-2 min-h-11 underline">重试</button></p>}
      {page?.nextCursor&&!error&&<Button variant="outline" size="sm" disabled={loading} onClick={()=>void load(page.nextCursor)}>加载更多使用记录</Button>}
    </div>}
  </section>;
}
