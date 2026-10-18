'use client';
import {useCallback,useEffect,useState} from 'react';
import {useAuth} from '@/lib/auth-context';

type Policy={ageGateEnabled:boolean;minimumAge:number|null;agePolicyVersion:string|null;termsVersion:string|null;privacyVersion:string|null;version:number};
const empty:Policy={ageGateEnabled:false,minimumAge:null,agePolicyVersion:null,termsVersion:null,privacyVersion:null,version:0};
export function ComplianceSettings({canManage=true}:{canManage?:boolean}){
  const {token}=useAuth();const [policy,setPolicy]=useState(empty);const [counts,setCounts]=useState<{policyType:string;policyVersion:string;count:number}[]>([]);const [reason,setReason]=useState('');const [error,setError]=useState('');const [message,setMessage]=useState('');const [busy,setBusy]=useState(false);
  const load=useCallback(async()=>{if(!token)return;const response=await fetch('/api/admin/compliance',{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});const data=await response.json();if(!response.ok)throw Error(data.error??'读取失败');setPolicy(data.policy??empty);setCounts(data.consentCounts??[]);},[token]);
  useEffect(()=>{void load().catch(value=>setError(value.message));},[load]);
  async function save(event:React.FormEvent){event.preventDefault();if(!token||busy)return;setBusy(true);setError('');setMessage('');try{const response=await fetch('/api/admin/compliance',{method:'PATCH',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({...policy,minimumAge:policy.minimumAge===null?null:Number(policy.minimumAge),reason})});const data=await response.json();if(!response.ok)throw Error(data.error??'保存失败');setPolicy(data.policy);setReason('');setMessage('合规要求已保存并写入管理审计。');await load();}catch(value){setError((value as Error).message);}finally{setBusy(false);}}
  const field='w-full rounded-lg border border-border bg-background px-3 py-2';
  return <main className="mx-auto max-w-4xl space-y-6"><div><h1 className="text-2xl font-bold">注册合规要求</h1><p className="mt-2 text-sm text-muted-foreground">配置注册时必须确认的政策版本。法律正文在站点内容页维护；此处只保存版本标识与确认记录，不采集出生日期或 IP。</p></div>
    {error&&<p role="alert" className="rounded-lg border border-red-500/30 p-3 text-red-600">{error}</p>}{message&&<p role="status" className="rounded-lg border border-emerald-500/30 p-3 text-emerald-600">{message}</p>}
    <form onSubmit={save} className="space-y-5 rounded-xl border border-border bg-card p-5">
      {!canManage&&<p className="text-sm text-muted-foreground">当前账号只有查看权限，设置不可修改。</p>}
      <fieldset disabled={!canManage} className="space-y-5">
      <label className="flex items-center gap-3"><input type="checkbox" checked={policy.ageGateEnabled} onChange={e=>setPolicy({...policy,ageGateEnabled:e.target.checked})}/>要求注册者确认达到最低年龄</label>
      <div className="grid gap-4 sm:grid-cols-2"><label className="space-y-1 text-sm">最低年龄<input className={field} type="number" min="1" max="120" value={policy.minimumAge??''} onChange={e=>setPolicy({...policy,minimumAge:e.target.value===''?null:Number(e.target.value)})}/></label><label className="space-y-1 text-sm">年龄政策版本<input className={field} value={policy.agePolicyVersion??''} onChange={e=>setPolicy({...policy,agePolicyVersion:e.target.value||null})} placeholder="例如 age-2026-01"/></label><label className="space-y-1 text-sm">服务条款版本<input className={field} value={policy.termsVersion??''} onChange={e=>setPolicy({...policy,termsVersion:e.target.value||null})} placeholder="留空则不要求确认"/></label><label className="space-y-1 text-sm">隐私政策版本<input className={field} value={policy.privacyVersion??''} onChange={e=>setPolicy({...policy,privacyVersion:e.target.value||null})} placeholder="留空则不要求确认"/></label></div>
      <label className="block space-y-1 text-sm">变更理由<input required maxLength={500} className={field} value={reason} onChange={e=>setReason(e.target.value)} placeholder="说明本次配置变更原因"/></label><button disabled={busy} className="min-h-11 rounded-lg bg-primary px-5 text-primary-foreground disabled:opacity-50">{busy?'保存中…':'保存设置'}</button>
      </fieldset>
    </form><section className="rounded-xl border border-border bg-card p-5"><h2 className="font-semibold">已记录的确认数</h2><p className="mt-1 text-sm text-muted-foreground">按政策版本汇总，不展示个人确认明细。</p>{counts.length?<ul className="mt-4 divide-y divide-border">{counts.map(row=><li key={`${row.policyType}:${row.policyVersion}`} className="flex justify-between py-2 text-sm"><span>{row.policyType} · {row.policyVersion}</span><span>{row.count}</span></li>)}</ul>:<p className="mt-4 text-sm text-muted-foreground">暂无确认记录</p>}</section>
  </main>;
}
