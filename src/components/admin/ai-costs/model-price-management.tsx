'use client';

import {useCallback,useEffect,useState,type FormEvent} from 'react';
import {useAdminAccess} from '@/components/admin/use-admin-access';

type Price={id:string;currency:string;inputPricePerMillion:string;outputPricePerMillion:string;effectiveAt:string;source:string;createdAt:string};
type Model={id:string;key:string;displayName:string;modelCode:string;providerName:string;isActive:boolean;prices:Price[]};
type Result={generatedAt:string;models:Model[]};
function localDateTime(){const date=new Date(Date.now()+60_000);date.setSeconds(0,0);return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}T${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;}

export function ModelPriceManagement(){
  const {token,permissions,loading}=useAdminAccess();const [data,setData]=useState<Result|null>(null);const [modelId,setModelId]=useState('');const [currency,setCurrency]=useState('USD');const [input,setInput]=useState('');const [output,setOutput]=useState('');const [effectiveAt,setEffectiveAt]=useState(localDateTime);const [source,setSource]=useState('');const [reason,setReason]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [notice,setNotice]=useState('');
  const canManage=permissions.includes('ai.costs.manage');
  const load=useCallback(async()=>{if(!token)return;const response=await fetch('/api/admin/ai/prices',{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});const result=await response.json();if(!response.ok)throw Error(result.error);setData(result);setModelId(current=>current||result.models[0]?.id||'');},[token]);
  useEffect(()=>{let active=true;if(token)void load().catch(cause=>{if(active)setError(cause instanceof Error?cause.message:'价格数据加载失败。');});return()=>{active=false;};},[token,load]);
  async function submit(event:FormEvent){event.preventDefault();if(!token)return;setBusy(true);setError('');setNotice('');try{const response=await fetch('/api/admin/ai/prices',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({modelId,currency,inputPricePerMillion:input,outputPricePerMillion:output,effectiveAt:new Date(effectiveAt).toISOString(),source,reason})});const result=await response.json();if(!response.ok)throw Error(result.error);setInput('');setOutput('');setSource('');setReason('');setNotice('价格版本已追加并写入审计；不会改变历史记录或启用聊天扣币。');await load();}catch(cause){setError(cause instanceof Error?cause.message:'价格版本保存失败。');}finally{setBusy(false);}}
  return <section className="space-y-5 rounded-2xl border border-border bg-card p-4 sm:p-6" aria-labelledby="ai-model-prices-title">
    <div className="space-y-1"><h2 id="ai-model-prices-title" className="text-lg font-semibold">模型价格历史</h2><p className="text-sm text-muted-foreground">按百万 Token 记录输入/输出单价、币种、来源和生效时间。保存为不可覆盖的历史版本，用于估算后续调用成本；不设置用户售价，也不会扣除金币。</p></div>
    {error&&<p role="alert" className="rounded-lg border border-destructive/40 p-3 text-sm">{error}</p>}{notice&&<p role="status" className="rounded-lg border p-3 text-sm">{notice}</p>}
    {!data?<p role="status" className="text-sm text-muted-foreground">正在加载模型价格…</p>:<>
      {canManage&&<form onSubmit={submit} className="grid gap-3 rounded-xl border border-border p-4 md:grid-cols-2">
        <label className="grid gap-1 text-sm">模型<select required value={modelId} onChange={event=>setModelId(event.target.value)} className="min-w-0 rounded-lg border border-border bg-background p-2"><option value="">选择模型</option>{data.models.map(model=><option key={model.id} value={model.id}>{model.displayName} · {model.providerName} · {model.key}{model.isActive?'':'（停用）'}</option>)}</select></label>
        <label className="grid gap-1 text-sm">币种<input required maxLength={3} pattern="[A-Z]{3}" value={currency} onChange={event=>setCurrency(event.target.value.toUpperCase())} className="rounded-lg border border-border bg-background p-2" /></label>
        <label className="grid gap-1 text-sm">输入单价 / 百万 Token<input required inputMode="decimal" pattern="\d{1,12}(\.\d{1,6})?" value={input} onChange={event=>setInput(event.target.value)} className="rounded-lg border border-border bg-background p-2" placeholder="例如 0.000000" /></label>
        <label className="grid gap-1 text-sm">输出单价 / 百万 Token<input required inputMode="decimal" pattern="\d{1,12}(\.\d{1,6})?" value={output} onChange={event=>setOutput(event.target.value)} className="rounded-lg border border-border bg-background p-2" placeholder="例如 0.000000" /></label>
        <label className="grid gap-1 text-sm">生效时间（按本机时区输入）<input required type="datetime-local" value={effectiveAt} onChange={event=>setEffectiveAt(event.target.value)} className="rounded-lg border border-border bg-background p-2" /></label>
        <label className="grid gap-1 text-sm">价格来源<input required maxLength={500} value={source} onChange={event=>setSource(event.target.value)} className="rounded-lg border border-border bg-background p-2" placeholder="供应商公开价格页或合同版本" /></label>
        <label className="grid gap-1 text-sm md:col-span-2">操作理由<input required maxLength={300} value={reason} onChange={event=>setReason(event.target.value)} className="rounded-lg border border-border bg-background p-2" /></label>
        <div className="flex flex-wrap items-center gap-3 md:col-span-2"><button disabled={busy||loading||!modelId} className="rounded-lg bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50">{busy?'保存中…':'追加价格版本'}</button><span className="text-xs text-muted-foreground">现有版本不能编辑或删除；新版本生效时间必须晚于已有版本。</span></div>
      </form>}
      {!data.models.length&&<p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">尚未建立数据库模型路由。先在“AI 模型管理”添加模型，再登记其价格。</p>}
      <div className="space-y-4">{data.models.map(model=><article key={model.id} className="min-w-0 space-y-2 rounded-xl border border-border p-4"><h3 className="break-words font-medium">{model.displayName} <span className="text-sm font-normal text-muted-foreground">{model.providerName} · {model.modelCode}</span></h3>{model.prices.length?<div className="space-y-2">{model.prices.map(price=><div key={price.id} className="grid gap-1 rounded-lg bg-muted/40 p-3 text-sm sm:grid-cols-[1fr_auto]"><div><p>{price.currency} · 输入 {price.inputPricePerMillion} / 输出 {price.outputPricePerMillion} / 百万 Token</p><p className="break-all text-xs text-muted-foreground">来源：{price.source}</p></div><time className="text-xs text-muted-foreground sm:text-right">生效 {new Date(price.effectiveAt).toLocaleString('zh-CN',{timeZone:'UTC'})} UTC</time></div>)}</div>:<p className="text-sm text-muted-foreground">尚无价格版本。当前 AI 调用成本仍按已配置的兼容环境单价估算或标记未知。</p>}</article>)}</div>
    </>}
  </section>;
}
