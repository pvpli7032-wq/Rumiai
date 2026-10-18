'use client';

import {useEffect,useState} from 'react';

type Report={
  generatedAt:string;since:string;days:number;
  users:{registered:number;active:number;payingUsers:number;registrationPaymentRate:number|null};
  engagement:{newConversations:number;userMessages:number;assistantMessages:number;visiblePosts:number;visibleComments:number;moderationActions:number};
  payments:{paidOrders:number;paidAmountCnyCents:number;completedRefunds:number;refundedAmountCnyCents:number};
  aiCosts:{currency:string;calls:number;knownCostCalls:number;unknownCostCalls:number;estimatedCost:number;failedCalls:number;mockCalls:number}[];
  retention:{available:boolean;dataFrom:string|null;cohorts:{cohortDate:string;cohortSize:number;d1:{returned:number;matured:boolean;rate:number|null};d7:{returned:number;matured:boolean;rate:number|null};d30:{returned:number;matured:boolean;rate:number|null}}[]};
  definitions:{activeUsers:string;retentionAvailable:boolean;grossMarginAvailable:boolean;grossMarginUnavailableReason:string};
};

const number=(value:number)=>new Intl.NumberFormat('zh-CN').format(value);
const yuan=(cents:number)=>'¥'+(cents/100).toFixed(2);

export function AnalyticsOverview({token}:{token:string}){
  const [days,setDays]=useState(7),[report,setReport]=useState<Report|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setError('');setReport(null);
    void fetch('/api/admin/analytics?days='+days,{headers:{Authorization:'Bearer '+token},cache:'no-store',signal:controller.signal})
      .then(async response=>{const data=await response.json();if(!response.ok)throw Error(data.error);return data as Report;})
      .then(setReport)
      .catch(reason=>{if(!controller.signal.aborted)setError(reason instanceof Error?reason.message:'运营分析读取失败。');})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[days,token]);

  const cards=report?[
    ['新注册用户',number(report.users.registered)],['活跃账号',number(report.users.active)],['付费用户',number(report.users.payingUsers)],
    ['新建对话',number(report.engagement.newConversations)],['用户消息',number(report.engagement.userMessages)],['AI 回复',number(report.engagement.assistantMessages)],
    ['公开帖子',number(report.engagement.visiblePosts)],['公开评论',number(report.engagement.visibleComments)],['审核动作',number(report.engagement.moderationActions)],
    ['已付订单',number(report.payments.paidOrders)],['支付金额',yuan(report.payments.paidAmountCnyCents)],['成功退款',number(report.payments.completedRefunds)],
  ]:[];

  return <main className="mx-auto w-full max-w-[1440px] space-y-5">
    <header className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-bold md:text-3xl">运营分析</h1><p className="mt-2 text-sm text-muted-foreground">按真实业务记录汇总；此页面不读取或展示聊天内容。</p></div><label className="space-x-2 text-sm">统计周期<select className="min-h-11 rounded-lg border bg-background px-3" value={days} onChange={event=>setDays(Number(event.target.value))}><option value={7}>近 7 天</option><option value={30}>近 30 天</option><option value={90}>近 90 天</option></select></label></header>
    {loading&&<p role="status">正在读取真实业务汇总…</p>}
    {error&&<p role="alert" className="rounded-lg border border-red-500/30 p-4 text-red-400">{error}</p>}
    {report&&<>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{cards.map(([label,value])=><article key={label} className="min-w-0 rounded-xl border bg-card p-4"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-2 break-words text-2xl font-semibold">{value}</p></article>)}</section>
      <section className="grid gap-4 xl:grid-cols-2">
        <article className="space-y-3 rounded-xl border bg-card p-4"><h2 className="font-semibold">转化与退款</h2><p>注册用户付费率：{report.users.registrationPaymentRate===null?'样本不足':(report.users.registrationPaymentRate*100).toFixed(2)+'%'}</p><p>退款金额：{yuan(report.payments.refundedAmountCnyCents)}</p><p>退款后充值金额：{yuan(report.payments.paidAmountCnyCents-report.payments.refundedAmountCnyCents)}</p><p className="text-sm text-muted-foreground">付费率沿用同周期注册与 EZFP 人民币已付款用户口径；退款只计已确认成功。</p></article>
        <article className="space-y-3 rounded-xl border bg-card p-4"><h2 className="font-semibold">AI 调用与成本估算</h2>{report.aiCosts.length?report.aiCosts.map(row=><div key={row.currency} className="rounded-lg border p-3"><p>{row.currency} · {number(row.calls)} 次调用 · 已知成本 {row.estimatedCost.toFixed(6)}</p><p className="mt-1 text-sm text-muted-foreground">已知 {number(row.knownCostCalls)} 次 · 未知 {number(row.unknownCostCalls)} 次 · 失败 {number(row.failedCalls)} 次 · 模拟 {number(row.mockCalls)} 次</p></div>):<p className="text-sm text-muted-foreground">此周期没有 AI 调用记录。</p>}<p className="text-sm text-muted-foreground">不同币种分开统计；未知成本没有按零处理。</p></article>
      </section>
      <section className="space-y-3 rounded-xl border bg-card p-4"><div><h2 className="font-semibold">注册 cohort 留存</h2><p className="text-sm text-muted-foreground">按 UTC 注册日统计在第 1、7、30 天再次认证的账号比例；仅展示汇总，不含用户标识。新采集数据从 {report.retention.dataFrom?new Date(report.retention.dataFrom).toLocaleDateString('zh-CN'):'今天'} 起，历史日期不会回填。</p></div>{!report.retention.cohorts.length?<p className="text-sm text-muted-foreground">暂无可展示的注册 cohort。</p>:<div className="max-w-full overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead><tr className="border-b text-muted-foreground"><th className="p-2">注册日（UTC）</th><th className="p-2">注册人数</th><th className="p-2">D1 留存</th><th className="p-2">D7 留存</th><th className="p-2">D30 留存</th></tr></thead><tbody>{report.retention.cohorts.map(row=><tr key={row.cohortDate} className="border-b"><td className="p-2">{row.cohortDate}</td><td className="p-2">{number(row.cohortSize)}</td>{[row.d1,row.d7,row.d30].map((metric,index)=><td key={index} className="p-2">{!metric.matured?'未成熟':metric.rate===null?'—':`${(metric.rate*100).toFixed(1)}% (${number(metric.returned)})`}</td>)}</tr>)}</tbody></table></div>}</section>
      <section className="space-y-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4"><h2 className="font-semibold">指标口径与数据缺口</h2><p className="text-sm">活跃账号：{report.definitions.activeUsers}</p><p className="text-sm">留存：以注册日为 cohort，D1/D7/D30 指注册后的第 1/7/30 个 UTC 日有成功认证活动；从采集起逐步成熟，不能回算采集前历史。</p><p className="text-sm">毛利暂不可计算：{report.definitions.grossMarginUnavailableReason}</p><p className="text-xs text-muted-foreground">统计区间：{new Date(report.since).toLocaleString('zh-CN')} 至 {new Date(report.generatedAt).toLocaleString('zh-CN')} · 汇总时间 {new Date(report.generatedAt).toLocaleString('zh-CN')}</p></section>
    </>}
  </main>;
}
