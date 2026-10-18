'use client';

import {useState} from 'react';

export type Mission={id:string;title:string;description:string|null;rewardCoins:number;category:string;conditionType:string;conditionTarget:number;period:string;isActive:boolean;sortOrder:number;version:number;startsAt:string|null;endsAt:string|null};
type Draft={id?:string;version:number;title:string;description:string;rewardCoins:number;category:string;conditionType:string;conditionTarget:number;period:string;isActive:boolean;sortOrder:number;startsAt:string;endsAt:string;reason:string};

const newDraft=(sortOrder:number):Draft=>({version:0,title:'',description:'',rewardCoins:0,category:'DAILY',conditionType:'CHECKIN_COUNT',conditionTarget:1,period:'DAILY',isActive:false,sortOrder,startsAt:'',endsAt:'',reason:''});
const localDate=(value:string|null)=>{if(!value)return '';const date=new Date(value),local=new Date(date.getTime()-date.getTimezoneOffset()*60_000);return local.toISOString().slice(0,16);};

export function MissionManagement({token,canManage,missions,onSaved}:{token:string;canManage:boolean;missions:Mission[];onSaved:()=>void}){
  const [draft,setDraft]=useState<Draft|null>(null),[saving,setSaving]=useState(false),[error,setError]=useState('');
  const change=<K extends keyof Draft>(key:K,value:Draft[K])=>setDraft(current=>current?{...current,[key]:value}:current);
  function edit(mission:Mission){setError('');setDraft({id:mission.id,version:mission.version,title:mission.title,description:mission.description??'',rewardCoins:mission.rewardCoins,category:mission.category,conditionType:mission.conditionType,conditionTarget:mission.conditionTarget,period:mission.period,isActive:mission.isActive,sortOrder:mission.sortOrder,startsAt:localDate(mission.startsAt),endsAt:localDate(mission.endsAt),reason:''});}
  async function save(){
    if(!draft)return;setSaving(true);setError('');
    const body={...draft,startsAt:draft.startsAt?new Date(draft.startsAt).toISOString():null,endsAt:draft.endsAt?new Date(draft.endsAt).toISOString():null};
    try{const response=await fetch(draft.id?`/api/admin/growth/missions/${draft.id}`:'/api/admin/growth/missions',{method:draft.id?'PATCH':'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await response.json();if(!response.ok)throw Error(data.error);setDraft(null);onSaved();}
    catch(e){setError(e instanceof Error?e.message:'任务保存失败。');}
    finally{setSaving(false);}
  }
  return <section className="space-y-4 rounded-xl border bg-card p-4">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">平台任务</h2><p className="text-sm text-muted-foreground">领取条件由服务器按签到、用户消息、公开帖子或评论核验；MANUAL 任务不能启用发奖。</p></div>{canManage&&<button className="min-h-11 rounded-lg border px-4" onClick={()=>{setError('');setDraft(newDraft(missions.length));}}>新建任务</button>}</header>
    {draft&&<div className="grid gap-3 rounded-xl border p-4 sm:grid-cols-2 xl:grid-cols-3">
      <label className="space-y-1 text-sm">任务名称<input value={draft.title} maxLength={100} onChange={e=>change('title',e.target.value)} className="min-h-11 w-full rounded-lg border bg-background px-3"/></label>
      <label className="space-y-1 text-sm">分类<select value={draft.category} onChange={e=>change('category',e.target.value)} className="min-h-11 w-full rounded-lg border bg-background px-3">{[['DAILY','每日'],['ONBOARDING','新手'],['STARTER','入门'],['SPECIAL','特别'],['CREATOR','创作']].map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
      <label className="space-y-1 text-sm">核验条件<select value={draft.conditionType} onChange={e=>change('conditionType',e.target.value)} className="min-h-11 w-full rounded-lg border bg-background px-3">{[['CHECKIN_COUNT','签到次数'],['MESSAGE_COUNT','用户消息数'],['POST_COUNT','公开帖子数'],['COMMENT_COUNT','公开评论数'],['MANUAL','手动核验（不可发奖）']].map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
      <label className="space-y-1 text-sm">目标数量<input type="number" min={1} max={10000} step={1} value={draft.conditionTarget} onChange={e=>change('conditionTarget',Number(e.target.value))} className="min-h-11 w-full rounded-lg border bg-background px-3"/></label>
      <label className="space-y-1 text-sm">重复周期<select value={draft.period} onChange={e=>change('period',e.target.value)} className="min-h-11 w-full rounded-lg border bg-background px-3"><option value="ONCE">一次</option><option value="DAILY">每日</option><option value="WEEKLY">每周</option></select></label>
      <label className="space-y-1 text-sm">金币奖励<input type="number" min={0} max={10000} step={1} value={draft.rewardCoins} onChange={e=>change('rewardCoins',Number(e.target.value))} className="min-h-11 w-full rounded-lg border bg-background px-3"/></label>
      <label className="space-y-1 text-sm">排序<input type="number" min={0} max={100000} value={draft.sortOrder} onChange={e=>change('sortOrder',Number(e.target.value))} className="min-h-11 w-full rounded-lg border bg-background px-3"/></label>
      <label className="space-y-1 text-sm">开始时间（本地）<input type="datetime-local" value={draft.startsAt} onChange={e=>change('startsAt',e.target.value)} className="min-h-11 w-full rounded-lg border bg-background px-3"/></label>
      <label className="space-y-1 text-sm">结束时间（本地）<input type="datetime-local" value={draft.endsAt} onChange={e=>change('endsAt',e.target.value)} className="min-h-11 w-full rounded-lg border bg-background px-3"/></label>
      <label className="space-y-1 text-sm sm:col-span-2">任务说明<textarea value={draft.description} maxLength={1000} onChange={e=>change('description',e.target.value)} className="min-h-20 w-full rounded-lg border bg-background p-3"/></label>
      <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={draft.isActive} onChange={e=>change('isActive',e.target.checked)}/>启用任务</label>
      <label className="space-y-1 text-sm sm:col-span-2">操作理由<input value={draft.reason} maxLength={500} onChange={e=>change('reason',e.target.value)} className="min-h-11 w-full rounded-lg border bg-background px-3"/></label>
      <div className="flex items-center gap-2 sm:col-span-2 xl:col-span-3"><button disabled={saving} onClick={()=>void save()} className="min-h-11 rounded-lg bg-primary px-4 text-primary-foreground disabled:opacity-50">{saving?'保存中…':'保存任务'}</button><button disabled={saving} onClick={()=>setDraft(null)} className="min-h-11 rounded-lg border px-4">取消</button>{error&&<p role="alert" className="text-sm text-red-400">{error}</p>}</div>
    </div>}
    <div className="space-y-2">{missions.map(mission=><article key={mission.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-3"><div className="min-w-0"><h3 className="font-medium">{mission.title} <span className="text-xs text-muted-foreground">{mission.isActive?'已启用':'已停用'} · {mission.period==='ONCE'?'一次':mission.period==='DAILY'?'每日':'每周'}</span></h3>{mission.description&&<p className="mt-1 text-sm text-muted-foreground">{mission.description}</p>}<p className="mt-1 text-xs text-muted-foreground">条件 {mission.conditionType} ≥ {mission.conditionTarget} · 奖励 {mission.rewardCoins} 金币{mission.startsAt?` · 开始 ${new Date(mission.startsAt).toLocaleString('zh-CN')}`:''}{mission.endsAt?` · 结束 ${new Date(mission.endsAt).toLocaleString('zh-CN')}`:''}</p></div>{canManage&&<button className="min-h-10 rounded-lg border px-3" onClick={()=>edit(mission)}>编辑</button>}</article>)}{!missions.length&&<p className="py-6 text-center text-sm text-muted-foreground">暂无平台任务。</p>}</div>
  </section>;
}
