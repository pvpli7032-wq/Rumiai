'use client';
import {useEffect,useState} from 'react';
import {useAdminAccess} from '../use-admin-access';

type Status={target:{hostname:string;port:number}|null;lastCheck:{status:string;verified:boolean;validFrom:string|null;validUntil:string|null;checkedAt:string;errorCode:string|null;fingerprint256:string|null;remainingDays:number|null}|null};
const labels:Record<string,string>={VALID:'有效',EXPIRING:'30天内到期',EXPIRED:'已过期',INVALID:'校验不通过',UNAVAILABLE:'无法连接'};
const time=(value:string|null)=>value?new Date(value).toLocaleString('zh-CN'):'未知';
export function CertificateStatus({token}:{token:string}){
  const {permissions}=useAdminAccess();const canCheck=permissions.includes('operations.certificates.check');
  const [status,setStatus]=useState<Status|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{const controller=new AbortController();setStatus(null);setError('');void fetch('/api/admin/operations/certificate',{headers:{Authorization:`Bearer ${token}`},cache:'no-store',signal:controller.signal}).then(async response=>{const data=await response.json();if(!response.ok)throw Error(data.error??'证书状态读取失败。');if(!controller.signal.aborted)setStatus(data);}).catch(value=>{if(!controller.signal.aborted)setError(value.message);});return()=>controller.abort();},[token]);
  async function check(){if(!canCheck||busy)return;setBusy(true);setError('');try{const response=await fetch('/api/admin/operations/certificate',{method:'POST',headers:{Authorization:`Bearer ${token}`},cache:'no-store'});const data=await response.json();if(!response.ok)throw Error(data.error??'证书检查失败。');setStatus(data);}catch(value){setError((value as Error).message);}finally{setBusy(false);}}
  const observation=status?.lastCheck;
  return <section aria-labelledby="certificate-title" className="space-y-3 rounded-xl border bg-card p-4"><div className="flex flex-wrap items-center justify-between gap-3"><h2 id="certificate-title" className="text-lg font-semibold">HTTPS 证书</h2>{canCheck&&<button type="button" disabled={busy||!status?.target} onClick={()=>void check()} className="min-h-11 rounded-lg border px-3 text-sm disabled:opacity-50">{busy?'检查中…':'检查证书'}</button>}</div>
    {error&&<p role="alert" className="text-red-400">{error}</p>}{!status&&!error&&<p role="status">正在读取证书状态…</p>}
    {status&&!status.target&&<p className="text-sm text-muted-foreground">尚未配置 HTTPS 站点地址，请由运维人员在服务器设置站点域名。</p>}
    {status?.target&&<><p className="break-all text-sm">检查目标：{status.target.hostname}:{status.target.port}</p>{observation?<div className="space-y-2 text-sm"><p>上次检查状态：<strong className={observation.status==='VALID'?'text-emerald-500':observation.status==='EXPIRING'?'text-amber-500':'text-red-400'}>{labels[observation.status]??observation.status}</strong></p><div className="grid gap-2 sm:grid-cols-2"><p>生效时间：{time(observation.validFrom)}</p><p>到期时间：{time(observation.validUntil)}</p></div><p>最近检查：{time(observation.checkedAt)}{observation.remainingDays!==null&&` · 距到期 ${observation.remainingDays} 天`}</p>{observation.errorCode&&<p className="break-all text-muted-foreground">原因码：{observation.errorCode}</p>}{observation.fingerprint256&&<details className="text-muted-foreground"><summary className="cursor-pointer">SHA-256 证书指纹</summary><p className="mt-2 break-all text-xs">{observation.fingerprint256}</p></details>}</div>:<p className="text-sm text-muted-foreground">此站点尚无证书检查记录。</p>}</>}
    <p className="text-xs text-muted-foreground">显示该次 TLS 检查的结果，不执行签发或续签，也不代表服务器自动续签已验收。</p>
  </section>;
}
