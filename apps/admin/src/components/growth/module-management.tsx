'use client';

import {useCallback,useEffect,useRef,useState} from 'react';
import {AdminNotice,AdminPanel} from '@admin/components/admin-page';
import {apiFetch} from '@admin/lib/api-client';
import {API} from '@rumiai/contracts/api-paths';
import type {GrowthModuleDescriptor,GrowthModuleId} from '@rumiai/contracts/growth/modules';
import {Badge} from '@rumiai/ui/badge';
import {Button} from '@rumiai/ui/button';
import {Input} from '@rumiai/ui/input';

type ModuleRow=GrowthModuleDescriptor&{isEnabled:boolean;config:Record<string,unknown>;version:number;updatedAt:string|null};

export function GrowthModuleManagement({sessionActive,canManage}:{sessionActive:boolean;canManage:boolean}){
  const [rows,setRows]=useState<ModuleRow[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState(''),[reason,setReason]=useState('');
  const [drafts,setDrafts]=useState<Partial<Record<GrowthModuleId,Record<string,unknown>>>>({}),[busyId,setBusyId]=useState<GrowthModuleId|null>(null);
  const busy=useRef(false);
  const load=useCallback(async()=>{
    if(!sessionActive)return;
    setLoading(true);setError('');
    try{const modules=(await apiFetch<{modules:ModuleRow[]}>(API.admin.growth.modules,{credentials:'same-origin',cache:'no-store'})).modules;setRows(modules);setDrafts(Object.fromEntries(modules.map(row=>[row.id,{...row.config}])));}
    catch(cause){setError(cause instanceof Error?cause.message:'玩法模块读取失败。');}
    finally{setLoading(false);}
  },[sessionActive]);
  useEffect(()=>{void load();},[load]);
  async function save(row:ModuleRow,isEnabled=row.isEnabled){
    if(busy.current||!canManage)return;
    if(!reason.trim()){setError('保存玩法变更前请填写操作理由。');return;}
    busy.current=true;setBusyId(row.id);setError('');setNotice('');
    try{
      await apiFetch(API.admin.growth.modules,{method:'PUT',credentials:'same-origin',body:{moduleId:row.id,isEnabled,config:drafts[row.id]??{},version:row.version,reason:reason.trim()}});
      setNotice(isEnabled===row.isEnabled?`${row.label}配置已保存。`:`${row.label}已${isEnabled?'启用':'停用'}；历史记录未删除。`);setReason('');await load();
    }catch(cause){setError(cause instanceof Error?cause.message:'玩法模块保存失败。');}
    finally{busy.current=false;setBusyId(null);}
  }
  return <AdminPanel title="玩法模块" description="模块代码来自可信静态注册表；这里只保存启停和声明过的配置。停用会阻止新的领取、签到或赠礼，但保留历史。">
    <div className="space-y-4">
      {error&&<AdminNotice tone="error" title={error}/>} {notice&&<AdminNotice tone="success" title={notice}/>} {loading&&<AdminNotice tone="loading" title="正在读取玩法模块…"/>}
      {!loading&&rows.map(row=><section key={row.id} data-growth-module={row.id} className="rounded-lg border border-border p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><div className="flex items-center gap-2"><h3 className="font-medium">{row.label}</h3><Badge>{row.isEnabled?'已启用':'已停用'}</Badge></div><p className="mt-1 text-sm text-muted-foreground">{row.description}</p></div>
          <Button variant={row.isEnabled?'outline':'primary'} loading={busyId===row.id} disabled={!canManage||busyId!==null} onClick={()=>void save(row,!row.isEnabled)}>{row.isEnabled?'停用':'启用'}</Button>
        </div>
        <dl className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3"><div>管理菜单：{row.menu.adminTab}</div><div>任务边界：{row.taskTypes.join('、')||'无'}</div><div>事件边界：{row.eventTypes.join('、')||'无'}</div></dl>
        {row.configSchema.fields.length>0&&<div className="mt-4 grid gap-3 border-t border-border pt-4 sm:grid-cols-2">{row.configSchema.fields.map(field=><label key={field.key} className="space-y-1.5 text-sm"><span className="font-medium">{field.label}</span>{field.type==='boolean'?<input type="checkbox" checked={drafts[row.id]?.[field.key]===true} onChange={event=>setDrafts({...drafts,[row.id]:{...drafts[row.id],[field.key]:event.target.checked}})}/>:<Input type={field.type==='integer'?'number':'text'} min={field.minimum} max={field.maximum} maxLength={field.maxLength} value={String(drafts[row.id]?.[field.key]??'')} onChange={event=>setDrafts({...drafts,[row.id]:{...drafts[row.id],[field.key]:field.type==='integer'?(event.target.value===''?undefined:Number(event.target.value)):event.target.value}})}/>}</label>)}<div className="sm:col-span-2"><Button type="button" variant="secondary" disabled={!canManage||busyId!==null} onClick={()=>void save(row)}>保存模块配置</Button></div></div>}
      </section>)}
      {canManage&&<label className="block space-y-1.5"><span className="text-sm font-medium">本次变更理由</span><Input maxLength={300} value={reason} onChange={event=>setReason(event.target.value)} aria-label="玩法模块变更理由" placeholder="会写入管理审计"/></label>}
      {!canManage&&<AdminNotice tone="info" title="当前账号只能查看玩法模块" description="启停与配置需要增长管理权限。"/>}
    </div>
  </AdminPanel>;
}
