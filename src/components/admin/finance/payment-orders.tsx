'use client';

import {useCallback,useEffect,useState,type FormEvent} from 'react';

type Refund={refundNo:string;status:string;errorCode:string|null;completedAt:string|null};
type CallbackEvent={provider:string;providerTradeNo:string;outcome:string;reasonCode:string|null;receivedAt:string};
type Order={
  orderNo:string;status:string;provider:string;providerTradeNo:string|null;currency:string;
  amountCnyCents:number;packageCoins:number;packageBonus:number;coinAmount:number;
  createdAt:string;paidAt:string|null;refund:Refund|null;callbackEvents:CallbackEvent[];
};
type OrderPage={page:number;pageSize:number;total:number;items:Order[]};

const statusLabel:Record<string,string>={
  PENDING:'待支付',PAID:'已支付',REFUND_PENDING:'退款处理中',REFUNDED:'已退款',FAILED:'支付失败',
  PROCESSING:'渠道处理中',UNKNOWN:'结果待核对',SUCCEEDED:'退款成功',
};

function money(order:Order){
  if(order.currency==='CNY')return '¥'+(order.amountCnyCents/100).toFixed(2);
  return order.currency+' '+(order.amountCnyCents/100).toFixed(2);
}

export function PaymentOrderManagement({token}:{token:string}){
  const [result,setResult]=useState<OrderPage|null>(null);
  const [status,setStatus]=useState('ALL');
  const [query,setQuery]=useState('');
  const [page,setPage]=useState(1);
  const [busy,setBusy]=useState(false);
  const [exporting,setExporting]=useState(false);
  const [error,setError]=useState('');

  const load=useCallback(async(signal?:AbortSignal)=>{
    setBusy(true);setError('');
    try{
      const params=new URLSearchParams({page:String(page),pageSize:'25',status});
      if(query.trim())params.set('q',query.trim());
      const response=await fetch('/api/admin/finance/orders/all?'+params,{
        headers:{Authorization:'Bearer '+token},cache:'no-store',signal,
      });
      const data=await response.json();
      if(!response.ok)throw Error(data.error);
      setResult(data);
    }catch(loadError){
      if(!signal?.aborted){
        setError(loadError instanceof Error?loadError.message:'订单列表加载失败。');
        setResult(null);
      }
    }finally{
      if(!signal?.aborted)setBusy(false);
    }
  },[page,query,status,token]);

  useEffect(()=>{
    const controller=new AbortController();
    void load(controller.signal);
    return()=>controller.abort();
  },[load]);

  function search(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(page!==1)setPage(1);
    else void load();
  }

  function changeStatus(value:string){
    setPage(1);
    setStatus(value);
  }

  async function exportCsv(){
    setExporting(true);setError('');
    try{
      const params=new URLSearchParams({status});
      if(query.trim())params.set('q',query.trim());
      const response=await fetch('/api/admin/finance/orders/export?'+params,{headers:{Authorization:'Bearer '+token},cache:'no-store'});
      if(!response.ok){const data=await response.json();throw Error(data.error);}
      const blob=await response.blob(),url=URL.createObjectURL(blob),anchor=document.createElement('a');
      anchor.href=url;anchor.download='payment-orders.csv';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch(exportError){setError(exportError instanceof Error?exportError.message:'订单导出失败。');}
    finally{setExporting(false);}
  }

  const pages=Math.max(1,Math.ceil((result?.total??0)/25));
  const renderOrder=(order:Order)=>(
    <article key={order.orderNo} className="space-y-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <strong className="break-all">{order.orderNo}</strong>
        <span className="rounded-full border px-2 py-1 text-xs">{statusLabel[order.status]??order.status}</span>
      </div>
      <p>{money(order)} · 实付金币 {order.coinAmount} 枚</p>
      <p className="text-sm text-muted-foreground">套餐 {order.packageCoins} 枚 · 活动赠送 {order.packageBonus} 枚</p>
      <p className="break-all text-sm text-muted-foreground">渠道 {order.provider} · 渠道单号 {order.providerTradeNo??'未返回'}</p>
      <p className="text-sm text-muted-foreground">创建 {new Date(order.createdAt).toLocaleString('zh-CN')} · 支付 {order.paidAt?new Date(order.paidAt).toLocaleString('zh-CN'):'尚未支付'}</p>
      {order.refund&&<p className="break-all text-sm text-muted-foreground">退款 {order.refund.refundNo} · {statusLabel[order.refund.status]??order.refund.status}{order.refund.errorCode?' · 核对码 '+order.refund.errorCode:''}</p>}
      <p className="break-all text-sm text-muted-foreground">已验签回调 {order.callbackEvents.length?order.callbackEvents.map(event=>`${event.outcome==='SETTLED'?'入账':event.outcome==='DUPLICATE'?'重复':'业务校验拒绝'+(event.reasonCode?' · '+event.reasonCode:'')} · ${event.providerTradeNo} · ${new Date(event.receivedAt).toLocaleString('zh-CN')}`).join('；'):'暂无记录'}</p>
    </article>
  );

  return <section className="space-y-4 rounded-xl border p-4">
    <header><h2 className="text-lg font-bold">充值订单</h2><p className="text-sm text-muted-foreground">只读订单快照与退款状态；退款执行在下方独立工作区。</p></header>
    <form className="flex flex-wrap items-end gap-3" onSubmit={search}>
      <label className="min-w-40 flex-1 space-y-1 text-sm">按订单号或渠道单号查找
        <input maxLength={80} className="min-h-11 w-full rounded-lg border bg-background px-3" value={query} onChange={event=>setQuery(event.target.value)}/>
      </label>
      <label className="space-y-1 text-sm">订单状态
        <select className="min-h-11 rounded-lg border bg-background px-3" value={status} onChange={event=>changeStatus(event.target.value)}>
          <option value="ALL">全部状态</option><option value="PENDING">待支付</option><option value="PAID">已支付</option><option value="REFUND_PENDING">退款处理中</option><option value="REFUNDED">已退款</option><option value="FAILED">支付失败</option>
        </select>
      </label>
      <button className="min-h-11 rounded-lg border px-4" disabled={busy}>查询</button>
      <button type="button" className="min-h-11 rounded-lg border px-4" disabled={exporting} onClick={()=>void exportCsv()}>{exporting?'正在导出…':'导出 CSV（最多 5000 笔）'}</button>
    </form>
    {error&&<p role="alert" className="text-red-400">{error}</p>}
    {busy&&!result&&<p role="status">正在读取订单…</p>}
    {result&&<>
      <div className="hidden overflow-x-auto rounded-lg border md:block">
        <table className="w-full min-w-[1100px] text-left text-sm">
          <thead><tr className="border-b bg-muted/30"><th className="p-3">订单</th><th className="p-3">状态</th><th className="p-3">金额与金币</th><th className="p-3">支付渠道</th><th className="p-3">退款</th><th className="p-3">验签回调</th><th className="p-3">时间</th></tr></thead>
          <tbody>{result.items.map(order=><tr key={order.orderNo} className="border-b align-top"><td className="max-w-64 break-all p-3 font-medium">{order.orderNo}<p className="mt-1 text-xs text-muted-foreground">渠道单号：{order.providerTradeNo??'未返回'}</p></td><td className="p-3">{statusLabel[order.status]??order.status}</td><td className="p-3 whitespace-nowrap">{money(order)}<p className="mt-1 text-xs text-muted-foreground">{order.coinAmount} 枚（基础 {order.packageCoins} + 赠送 {order.packageBonus}）</p></td><td className="p-3">{order.provider}</td><td className="max-w-56 break-all p-3">{order.refund?((statusLabel[order.refund.status]??order.refund.status)+' · '+order.refund.refundNo+(order.refund.errorCode?' · '+order.refund.errorCode:'')):'无'}</td><td className="max-w-64 break-all p-3">{order.callbackEvents.length?order.callbackEvents.map((event,index)=><p className="mb-1" key={event.receivedAt+'-'+index}>{event.outcome==='SETTLED'?'入账':event.outcome==='DUPLICATE'?'重复':'业务校验拒绝'+(event.reasonCode?' · '+event.reasonCode:'')} · {event.providerTradeNo} · {new Date(event.receivedAt).toLocaleString('zh-CN')}</p>):'暂无记录'}</td><td className="whitespace-nowrap p-3">创建 {new Date(order.createdAt).toLocaleString('zh-CN')}<p className="mt-1 text-xs text-muted-foreground">支付 {order.paidAt?new Date(order.paidAt).toLocaleString('zh-CN'):'—'}</p></td></tr>)}</tbody>
        </table>
      </div>
      <div className="space-y-3 md:hidden">{result.items.map(renderOrder)}</div>
      {!result.items.length&&<p className="text-sm text-muted-foreground">没有匹配的充值订单。</p>}
      <div className="flex flex-wrap items-center gap-3 text-sm"><span>共 {result.total} 笔 · 第 {result.page} / {pages} 页</span><button className="min-h-10 rounded-lg border px-3" disabled={busy||page<=1} onClick={()=>setPage(current=>current-1)}>上一页</button><button className="min-h-10 rounded-lg border px-3" disabled={busy||page>=pages} onClick={()=>setPage(current=>current+1)}>下一页</button></div>
    </>}
  </section>;
}

