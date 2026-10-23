
'use client';
import { useEffect,useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@web/lib/auth-context';
type Call={id:string;status:string;model:string|null;inputTokens:number|null;outputTokens:number|null;estimatedCost:number|null;currency:string;startedAt:string};
type Usage={used:number;limit:number;remaining:number;resetAt:string;calls:Call[]};
const labels:Record<string,string>={SUCCEEDED:'已完成',FAILED:'失败',CANCELLED:'已取消',MOCK:'模拟测试',STARTED:'处理中'};
export default function AiUsage(){
 const {token,isLoading}=useAuth(),[usage,setUsage]=useState<Usage|null>(null),[error,setError]=useState('');
 useEffect(()=>{if(!token)return;const controller=new AbortController();setUsage(null);setError('');fetch('/api/ai/usage',{signal:controller.signal,headers:{Authorization:'Bearer '+token}}).then(async res=>{const data=await res.json();if(!res.ok)throw Error(data.error);if(!controller.signal.aborted)setUsage(data)}).catch(e=>{if(!controller.signal.aborted)setError(e.message)});return()=>controller.abort()},[token]);
 if(!token&&!isLoading)return <main className="p-4"><Link href="/login?next=/ai-usage">请先登录</Link></main>;
 return <main className="mx-auto max-w-3xl space-y-4 p-4"><h1 className="text-xl font-bold">AI 用量与额度</h1>{error?<p role="alert">{error}</p>:!usage?<p role="status">正在加载…</p>:<><section className="rounded-xl border border-border p-4"><p>今日已用 {usage.used} / {usage.limit} 次</p><p className="mt-2 text-lg font-semibold">剩余 {usage.remaining} 次</p><p className="mt-2 text-sm text-muted-foreground">重置时间：{new Date(usage.resetAt).toLocaleString('zh-CN')}</p><p className="mt-2 text-sm text-muted-foreground">失败、取消和重新生成也计入调用次数；超过额度的请求不会扣次数。</p></section><h2 className="font-semibold">最近调用</h2><p className="text-sm text-muted-foreground">费用为配置单价估算，供研发核对，不是扣费账单。缺少用量或单价时显示未知。</p>{!usage.calls.length?<p>暂无调用记录。</p>:<ul className="space-y-3">{usage.calls.map(call=><li key={call.id} className="space-y-2 break-words rounded-xl border border-border p-4"><p>{labels[call.status]||'未知状态'} · {call.model||'未调用真实模型'}</p><p className="text-sm text-muted-foreground">{new Date(call.startedAt).toLocaleString('zh-CN')}</p><p className="text-sm">输入 / 输出用量：{call.inputTokens??'未知'} / {call.outputTokens??'未知'} Token</p><p className="text-sm">估算费用：{call.estimatedCost===null?'未知':call.estimatedCost.toFixed(6)+' '+call.currency}</p></li>)}</ul>}</>}</main>
}
