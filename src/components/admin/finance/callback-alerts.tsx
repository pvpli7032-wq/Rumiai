'use client';

import {useCallback,useEffect,useState} from 'react';

type Summary={hours:number;generatedAt:string;since:string;retentionDays:number;sampling:string;sampledMinutes:number;reasons:Array<{reasonCode:string;label:string;sampledMinutes:number;firstSeenAt:string;lastSeenAt:string}>};
export function CallbackAlerts({token}:{token:string}){
  const [hours,setHours]=useState(24),[summary,setSummary]=useState<Summary|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false);
  const load=useCallback(async(range:number)=>{setLoading(true);setError('');try{const response=await fetch(`/api/admin/finance/callback-alerts?hours=${range}`,{headers:{Authorization:'Bearer '+token},cache:'no-store'});const data=await response.json();if(!response.ok)throw Error(data.error);setSummary(data);}catch(e){setError(e instanceof Error?e.message:'支付回调告警读取失败。');}finally{setLoading(false);}},[token]);
  useEffect(()=>{void load(hours);},[hours,load]);
  return <section className="space-y-3 rounded-xl border p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-bold">支付回调异常（聚合）</h2><p className="text-sm text-muted-foreground">仅记录异常类型与采样时间，不保存通知内容、订单号或交易号；保留30天。</p></div><label className="text-sm">时间范围 <select aria-label="回调告警时间范围" className="min-h-10 rounded-md border bg-background px-2" value={hours} disabled={loading} onChange={event=>setHours(Number(event.target.value))}><option value={24}>近24小时</option><option value={168}>近7天</option></select></label></div>
    {error&&<p role="alert" className="text-sm text-red-400">{error}</p>}{loading&&!summary&&<p role="status">正在读取回调告警…</p>}
    {summary&&<><p role="status">近{summary.hours===24?'24小时':'7天'}记录到 {summary.sampledMinutes} 个异常采样分钟。</p>{summary.reasons.length?<div className="divide-y">{summary.reasons.map(row=><article key={row.reasonCode} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"><span>{row.label}</span><span className="text-muted-foreground">{row.sampledMinutes} 分钟 · 最近 {new Date(row.lastSeenAt).toLocaleString('zh-CN')}</span></article>)}</div>:<p className="py-2 text-sm text-muted-foreground">此范围内未观察到回调拒绝。</p>}<p className="text-xs text-muted-foreground">{summary.sampling}</p></>}
    <button type="button" className="min-h-10 rounded-md border px-3 text-sm" disabled={loading} onClick={()=>void load(hours)}>刷新</button>
  </section>;
}
