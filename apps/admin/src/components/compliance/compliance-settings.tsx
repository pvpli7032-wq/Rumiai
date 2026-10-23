'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {useAdminAccess} from '@admin/components/use-admin-access';
import {AdminNotice, AdminPage, AdminPageHeader, AdminPanel} from '../admin-page';
import {Button} from '@rumiai/ui/button';
import {Input} from '@rumiai/ui/input';

type Policy={ageGateEnabled:boolean;minimumAge:number|null;agePolicyVersion:string|null;termsVersion:string|null;privacyVersion:string|null;version:number};
const empty:Policy={ageGateEnabled:false,minimumAge:null,agePolicyVersion:null,termsVersion:null,privacyVersion:null,version:0};
export function ComplianceSettings({canManage=true}:{canManage?:boolean}){
  const {sessionActive}=useAdminAccess();const [policy,setPolicy]=useState(empty);const [counts,setCounts]=useState<{policyType:string;policyVersion:string;count:number}[]>([]);const [reason,setReason]=useState('');const [error,setError]=useState('');const [message,setMessage]=useState('');const [busy,setBusy]=useState(false);const busyRef=useRef(false);
  const load=useCallback(async()=>{if(!sessionActive)return;const response=await fetch('/api/admin/compliance',{credentials: 'include',cache:'no-store'});const data=await response.json();if(!response.ok)throw Error(data.error??'读取失败');setPolicy(data.policy??empty);setCounts(data.consentCounts??[]);},[sessionActive]);
  useEffect(()=>{void load().catch(value=>setError(value.message));},[load]);
  async function save(event:React.FormEvent){event.preventDefault();if(!sessionActive||busyRef.current)return;busyRef.current=true;setBusy(true);setError('');setMessage('');try{const response=await fetch('/api/admin/compliance',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({...policy,minimumAge:policy.minimumAge===null?null:Number(policy.minimumAge),reason})});const data=await response.json();if(!response.ok)throw Error(data.error??'保存失败');setPolicy(data.policy);setReason('');setMessage('合规要求已保存并写入管理审计。');await load();}catch(value){setError((value as Error).message);}finally{busyRef.current=false;setBusy(false);}}
  const numberValue=(value:number|null)=>value===null?'':String(value);
  return (
    <AdminPage width="narrow">
      <AdminPageHeader eyebrow="系统与安全" title="注册合规" description="配置注册时必须确认的政策版本。法律正文在站点内容页维护；此处只保存版本标识与确认记录，不采集出生日期或 IP。" />
      {error&&<AdminNotice tone="error" title={error} className="py-6" />}
      {message&&<AdminNotice tone="success" title={message} className="py-6" />}

      <AdminPanel className="border-border bg-card shadow-sm" title="注册确认要求" description={canManage ? '保存会写入管理审计，请填写变更理由。' : '当前账号只有查看权限，设置不可修改。'}>
        <form onSubmit={save} className="space-y-5">
          <fieldset disabled={!canManage} className="space-y-5">
            <label className="flex min-h-11 flex-wrap items-center gap-3 text-sm font-medium">
              <input type="checkbox" className="h-4 w-4 rounded border-border accent-brand" checked={policy.ageGateEnabled} onChange={e=>setPolicy({...policy,ageGateEnabled:e.target.checked})}/>
              要求注册者确认达到最低年龄
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">最低年龄</span>
                <Input type="number" min="1" max="120" value={numberValue(policy.minimumAge)} onChange={e=>setPolicy({...policy,minimumAge:e.target.value===''?null:Number(e.target.value)})}/>
              </label>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">年龄政策版本</span>
                <Input value={policy.agePolicyVersion??''} onChange={e=>setPolicy({...policy,agePolicyVersion:e.target.value||null})} placeholder="例如 age-2026-01"/>
              </label>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">服务条款版本</span>
                <Input value={policy.termsVersion??''} onChange={e=>setPolicy({...policy,termsVersion:e.target.value||null})} placeholder="留空则不要求确认"/>
              </label>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">隐私政策版本</span>
                <Input value={policy.privacyVersion??''} onChange={e=>setPolicy({...policy,privacyVersion:e.target.value||null})} placeholder="留空则不要求确认"/>
              </label>
            </div>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">变更理由</span>
              <Input required maxLength={500} value={reason} onChange={e=>setReason(e.target.value)} placeholder="说明本次配置变更原因"/>
            </label>
            <Button type="submit" loading={busy} disabled={!canManage}>{busy?'保存中…':'保存设置'}</Button>
          </fieldset>
        </form>
      </AdminPanel>

      <AdminPanel className="border-border bg-card shadow-sm" title="已记录的确认数" description="按政策版本汇总，不展示个人确认明细。">
        {counts.length
          ? <ul className="divide-y divide-border">{counts.map(row=><li key={`${row.policyType}:${row.policyVersion}`} className="flex items-center justify-between py-2.5 text-sm"><span className="text-foreground">{row.policyType} · {row.policyVersion}</span><span className="font-medium tabular-nums">{row.count}</span></li>)}</ul>
          : <p className="text-sm text-muted-foreground">暂无确认记录</p>}
      </AdminPanel>
    </AdminPage>
  );
}
