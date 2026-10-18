'use client';
import {useEffect,useState} from 'react';
import {useAdminAccess} from '../use-admin-access';

type Policy={enabled:boolean;message:string;retryAfterSeconds:number;version:number};
export function MaintenanceSettings({token}:{token:string}){
  const {permissions}=useAdminAccess();const canManage=permissions.includes('operations.maintenance.manage');
  const [policy,setPolicy]=useState<Policy|null>(null),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[revision,setRevision]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();setPolicy(null);setError('');
    void fetch('/api/admin/operations/maintenance',{headers:{Authorization:`Bearer ${token}`},cache:'no-store',signal:controller.signal}).then(async response=>{const data=await response.json();if(!response.ok)throw Error(data.error??'维护设置读取失败。');if(!controller.signal.aborted)setPolicy(data);}).catch(value=>{if(!controller.signal.aborted)setError(value.message);});
    return()=>controller.abort();
  },[token,revision]);
  async function save(event:React.FormEvent){
    event.preventDefault();if(!policy||!canManage||busy)return;setBusy(true);setError('');setMessage('');
    try{const response=await fetch('/api/admin/operations/maintenance',{method:'PATCH',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({...policy,reason})});const data=await response.json();if(!response.ok)throw Error(data.error??'维护设置保存失败。');setPolicy(data);setReason('');setMessage(data.enabled?'维护模式已开启，新业务提交暂停。':'维护模式已关闭，业务提交恢复。');}
    catch(value){setError((value as Error).message);}finally{setBusy(false);}
  }
  return <section aria-labelledby="maintenance-title" className="space-y-4 rounded-xl border bg-card p-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="maintenance-title" className="text-lg font-semibold">业务只读维护</h2><button type="button" disabled={busy} onClick={()=>setRevision(value=>value+1)} className="min-h-11 rounded-lg border px-3 text-sm">刷新维护设置</button></div>
    <p className="text-sm text-muted-foreground">开启后暂停注册、聊天、发帖、充值和上传等新提交。浏览与查询、登录/退出、管理接口及支付回调继续处理；已经开始的请求继续完成。</p>
    {error&&<p role="alert" className="text-red-400">{error}</p>}{message&&<p role="status">{message}</p>}
    {!policy&&!error&&<p role="status">正在读取维护设置…</p>}
    {policy&&<form className="space-y-4" onSubmit={save}><fieldset disabled={!canManage||busy} className="space-y-4">
      <label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={policy.enabled} onChange={event=>setPolicy({...policy,enabled:event.target.checked})}/>开启业务只读维护</label>
      <div className="grid gap-4 md:grid-cols-2"><label className="block text-sm">维护提示<textarea required maxLength={300} value={policy.message} onChange={event=>setPolicy({...policy,message:event.target.value})} className="mt-1 min-h-24 w-full rounded-lg border bg-background p-3"/></label><label className="block text-sm">建议重试秒数<input type="number" required min={60} max={86400} value={policy.retryAfterSeconds} onChange={event=>setPolicy({...policy,retryAfterSeconds:Number(event.target.value)})} className="mt-1 min-h-11 w-full rounded-lg border bg-background px-3"/></label></div>
      {canManage&&<><label className="block text-sm">维护变更理由<input required maxLength={500} value={reason} onChange={event=>setReason(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border bg-background px-3"/></label><button disabled={busy||!reason.trim()} className="min-h-11 rounded-lg border px-4 disabled:opacity-50">保存维护设置</button></>}
    </fieldset>{!canManage&&<p className="text-sm text-muted-foreground">当前账号只有运维查看权限。</p>}</form>}
  </section>;
}
