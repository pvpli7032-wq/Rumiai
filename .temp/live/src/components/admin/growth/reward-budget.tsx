'use client';

import {useEffect,useState} from 'react';

type Report={days:number;since:string;generatedAt:string;budgetLimitConfigured:boolean;totalClaims:number;totalCoins:number;sources:{key:string;label:string;claims:number;coins:number}[];daily:{date:string;claims:number;coins:number}[]};
const format=(value:number)=>new Intl.NumberFormat('zh-CN').format(value);

export function RewardBudget({token}:{token:string}){
  const [days,setDays]=useState(7),[report,setReport]=useState<Report|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setError('');
    void fetch(`/api/admin/growth/rewards?days=${days}`,{headers:{Authorization:'Bearer '+token},cache:'no-store',signal:controller.signal})
      .then(async response=>{const data=await response.json();if(!response.ok)throw Error(data.error);return data as Report;})
      .then(setReport).catch(reason=>{if(!controller.signal.aborted)setError(reason instanceof Error?reason.message:'奖励发放统计读取失败。');})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[days,token]);
  return <section className="space-y-4 rounded-xl border bg-card p-4">
    <header className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-lg font-semibold">奖励发放监控</h2><p className="text-sm text-muted-foreground">按金币账本来源汇总真实发放笔数和金币；当前没有设置预算上限，因此只展示消耗，不做封顶拦截。</p></div><label className="space-x-2 text-sm">统计周期<select aria-label="奖励统计周期" className="min-h-11 rounded-lg border bg-background px-3" value={days} onChange={event=>setDays(Number(event.target.value))}><option value={7}>近 7 天</option><option value={30}>近 30 天</option><option value={90}>近 90 天</option></select></label></header>
    {loading&&<p role="status">正在汇总金币奖励流水…</p>}{error&&<p role="alert" className="text-sm text-red-400">{error}</p>}
    {report&&<><div className="grid gap-3 sm:grid-cols-3"><article className="rounded-lg border p-3"><p className="text-sm text-muted-foreground">奖励金币</p><p className="mt-1 text-2xl font-semibold">{format(report.totalCoins)}</p></article><article className="rounded-lg border p-3"><p className="text-sm text-muted-foreground">领取笔数</p><p className="mt-1 text-2xl font-semibold">{format(report.totalClaims)}</p></article><article className="rounded-lg border p-3"><p className="text-sm text-muted-foreground">预算上限</p><p className="mt-1 font-semibold">{report.budgetLimitConfigured?'已配置':'未配置'}</p></article></div>
      <div className="grid gap-2 sm:grid-cols-3">{report.sources.map(source=><article key={source.key} className="min-w-0 rounded-lg border p-3"><h3 className="font-medium">{source.label}</h3><p className="mt-1 text-sm">{format(source.coins)} 金币 · {format(source.claims)} 笔领取</p></article>)}</div>
      <div className="max-w-full overflow-x-auto"><table className="w-full min-w-[360px] text-left text-sm"><thead><tr className="border-b text-muted-foreground"><th className="p-2">UTC 日期</th><th className="p-2">发放金币</th><th className="p-2">领取笔数</th></tr></thead><tbody>{report.daily.map(row=><tr key={row.date} className="border-b"><td className="p-2">{row.date}</td><td className="p-2">{format(row.coins)}</td><td className="p-2">{format(row.claims)}</td></tr>)}</tbody></table>{!report.daily.length&&<p className="p-3 text-sm text-muted-foreground">所选时间内暂无奖励领取。</p>}</div>
      <p className="text-xs text-muted-foreground">统计区间：{new Date(report.since).toLocaleString('zh-CN')} 至 {new Date(report.generatedAt).toLocaleString('zh-CN')}。零金币任务仍计入领取笔数；金币金额来自有来源标记的账本流水。</p></>}
  </section>;
}
