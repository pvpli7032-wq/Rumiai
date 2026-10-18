'use client';

import {useEffect,useState} from 'react';

type Rule={streakDay:number;rewardCoins:number;version:number};

export function CheckinRewards({token,canManage,onSaved}:{token:string;canManage:boolean;onSaved:()=>void}){
  const [rules,setRules]=useState<Rule[]>([]),[reason,setReason]=useState(''),[error,setError]=useState(''),[saving,setSaving]=useState(false);
  useEffect(()=>{const controller=new AbortController();void fetch('/api/admin/growth/checkins',{headers:{Authorization:'Bearer '+token},cache:'no-store',signal:controller.signal}).then(async response=>{const data=await response.json();if(!response.ok)throw Error(data.error);setRules(data.rules);}).catch(e=>{if(!controller.signal.aborted)setError(e.message);});return()=>controller.abort();},[token]);
  function change(day:number,value:string){setRules(rows=>rows.map(row=>row.streakDay===day?{...row,rewardCoins:Number(value)}:row));}
  async function save(){
    setSaving(true);setError('');
    try{const response=await fetch('/api/admin/growth/checkins',{method:'PUT',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({rules,reason})});const data=await response.json();if(!response.ok)throw Error(data.error);const refreshed=await fetch('/api/admin/growth/checkins',{headers:{Authorization:'Bearer '+token},cache:'no-store'});const updated=await refreshed.json();if(!refreshed.ok)throw Error(updated.error);setRules(updated.rules);setReason('');onSaved();}
    catch(e){setError(e instanceof Error?e.message:'签到奖励保存失败。');}
    finally{setSaving(false);}
  }
  return <section className="space-y-4 rounded-xl border bg-card p-4">
    <header><h2 className="text-lg font-semibold">连续签到金币</h2><p className="text-sm text-muted-foreground">第 7 天及以后按第 7 天金额发放。修改将影响之后的签到，不追溯历史流水。</p></header>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{rules.map(rule=><label key={rule.streakDay} className="space-y-1 text-sm">第 {rule.streakDay} 天<input aria-label={`第 ${rule.streakDay} 天签到奖励`} type="number" min={0} max={10000} step={1} disabled={!canManage||saving} value={rule.rewardCoins} onChange={event=>change(rule.streakDay,event.target.value)} className="min-h-11 w-full rounded-lg border bg-background px-3"/></label>)}</div>
    {canManage&&<div className="flex flex-wrap items-end gap-3"><label className="min-w-60 flex-1 space-y-1 text-sm">操作理由<input value={reason} maxLength={500} onChange={event=>setReason(event.target.value)} className="min-h-11 w-full rounded-lg border bg-background px-3"/></label><button disabled={saving||!reason.trim()||rules.length!==7} onClick={()=>void save()} className="min-h-11 rounded-lg bg-primary px-4 text-primary-foreground disabled:opacity-50">{saving?'保存中…':'保存签到奖励'}</button></div>}
    {error&&<p role="alert" className="text-sm text-red-400">{error}</p>}
  </section>;
}
