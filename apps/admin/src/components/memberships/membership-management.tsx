'use client';
import {useEffect,useState} from 'react';
import {AdminNotice,AdminPage,AdminPanel} from '@admin/components/admin-page';
import {AdminPageHeader} from '@admin/components/layout/admin-page-header';
import {Button} from '@rumiai/ui/button';
import {Input} from '@rumiai/ui/input';
import {MEMBERSHIP_BENEFIT_RULES,type MembershipBenefit as Benefit,type MembershipPlanPublic as Plan,type MembershipCatalogPublic as Catalog} from '@rumiai/contracts/memberships';
const LABELS={DAILY_FREE_REPLIES:'每日额外免费回复',CHAT_PRICE_MULTIPLIER:'聊天收费倍率（0.8 表示八折）',CHARACTER_CREATE_LIMIT:'会员角色总上限'} as const;
const DEFS=(Object.keys(LABELS) as Array<keyof typeof LABELS>).map(key=>[key,LABELS[key],MEMBERSHIP_BENEFIT_RULES[key].min,MEMBERSHIP_BENEFIT_RULES[key].max] as const);
const defaults:Catalog={policy:{version:0,refundWindowHours:24,usageChargePeriodHours:24},plans:[]};
export function MembershipManagement(){
 const [catalog,setCatalog]=useState<Catalog>(defaults),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[message,setMessage]=useState('');
 useEffect(()=>{fetch('/api/admin/memberships',{credentials:'same-origin',cache:'no-store'}).then(r=>r.ok?r.json():Promise.reject()).then(setCatalog).catch(()=>setMessage('会员配置读取失败。')).finally(()=>setLoading(false));},[]);
 const updatePlan=(i:number,p:Partial<Plan>)=>setCatalog(c=>({...c,plans:c.plans.map((x,n)=>n===i?{...x,...p}:x)}));
 const benefit=(p:Plan,key:Benefit['key'])=>p.benefits.find(x=>x.key===key);
 const toggleBenefit=(i:number,key:Benefit['key'],on:boolean)=>setCatalog(c=>({...c,plans:c.plans.map((p,n)=>{if(n!==i)return p;const old=benefit(p,key);return {...p,benefits:on?[...p.benefits.filter(x=>x.key!==key),{key,label:old?.label??DEFS.find(x=>x[0]===key)![1],value:old?.value??1}]:p.benefits.filter(x=>x.key!==key)};})}));
 const updateBenefit=(i:number,key:Benefit['key'],patch:Partial<Benefit>)=>setCatalog(c=>({...c,plans:c.plans.map((p,n)=>n!==i?p:{...p,benefits:p.benefits.map(x=>x.key===key?{...x,...patch}:x)})}));
 async function save(){
  if(saving)return;
  setSaving(true);setMessage('');let savedCount=0;
  try{
   if(catalog.plans.some(p=>p.priceCents!==null&&(!Number.isSafeInteger(p.priceCents)||p.priceCents<1)))throw Error('已定价套餐价格必须为正整数分；未定价请留空。');
   const pr=await fetch('/api/admin/memberships',{method:'PATCH',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({kind:'policy',...catalog.policy,reason:'后台会员规则配置'})});
   if(!pr.ok)throw Error((await pr.json()).error??'保存退款规则失败。');
   let next:Catalog={...catalog,policy:await pr.json()};
   setCatalog(next);savedCount++;
   for(const plan of catalog.plans){
    const r=await fetch('/api/admin/memberships',{method:'PATCH',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({...plan,reason:'后台会员套餐配置'})});
    if(!r.ok)throw Error((await r.json()).error??`保存${plan.name}失败。`);
    const saved:Plan=await r.json();
    next={...next,plans:next.plans.map(x=>x.id===saved.id?saved:x)};
    setCatalog(next);savedCount++;
   }
   setMessage('已保存，前台将读取最新方案。');
  }catch(e){setMessage(`${savedCount?`部分未保存（此前 ${savedCount} 项已生效）：`:''}${e instanceof Error?e.message:'保存失败，请重试。'}`);}
  finally{setSaving(false);}
 }
 if(loading)return <AdminPage><AdminNotice tone="loading" title="正在读取会员配置…"/></AdminPage>;
 return <AdminPage width="default"><AdminPageHeader eyebrow="财务与商业" title="会员方案" description="价格、时长、可执行权益与退款规则统一配置。" actions={<Button onClick={()=>void save()} disabled={saving}>{saving?'保存中…':'保存配置'}</Button>}/>{message&&<AdminNotice tone={message.startsWith('已')?'success':'error'} title={message}/>}<fieldset disabled={saving} className="contents"><AdminPanel title="退款规则"><div className="grid gap-4 p-5 md:grid-cols-2"><label className="text-sm">退款窗口（小时）<Input type="number" min={1} max={168} value={catalog.policy.refundWindowHours} onChange={e=>setCatalog({...catalog,policy:{...catalog.policy,refundWindowHours:Number(e.target.value)}})}/></label><label className="text-sm">使用后扣费周期（小时）<Input type="number" min={1} max={720} value={catalog.policy.usageChargePeriodHours} onChange={e=>setCatalog({...catalog,policy:{...catalog.policy,usageChargePeriodHours:Number(e.target.value)}})}/></label></div></AdminPanel><div className="grid gap-4 md:grid-cols-3">{catalog.plans.map((p,i)=><AdminPanel key={p.id} title={p.name}><div className="space-y-4 p-5"><label className="block text-sm">名称<Input value={p.name} onChange={e=>updatePlan(i,{name:e.target.value})}/></label><label className="block text-sm">价格（分）<Input type="number" min={1} value={p.priceCents??''} onChange={e=>updatePlan(i,{priceCents:e.target.value===''?null:Number(e.target.value)})}/></label><label className="block text-sm">时长（天）<Input type="number" min={1} readOnly={p.code==='MONTHLY'} value={p.durationDays} onChange={e=>updatePlan(i,{durationDays:Number(e.target.value)})}/></label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={p.isActive} onChange={e=>updatePlan(i,{isActive:e.target.checked})}/>前台开放购买</label><fieldset className="space-y-2"><legend className="text-sm font-medium">可执行权益</legend>{DEFS.map(([key,label,min,max])=>{const b=benefit(p,key);return <div key={key} className="rounded border border-border p-3"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!b} onChange={e=>toggleBenefit(i,key,e.target.checked)}/>{label}</label>{b&&<div className="mt-2 grid gap-2"><Input value={b.label} onChange={e=>updateBenefit(i,key,{label:e.target.value})}/><Input type="number" min={min} max={max} step={MEMBERSHIP_BENEFIT_RULES[key].kind === 'integer' ? 1 : 0.01} value={b.value} onChange={e=>updateBenefit(i,key,{value:Number(e.target.value)})}/></div>}</div>})}</fieldset></div></AdminPanel>)}</div></fieldset><p className="text-xs text-muted-foreground">角色权益表示会员总上限。须先在设置中心配置有限的公共角色数量上限；默认公共不限制时，这项权益没有额外增益，不开放为可购买权益。</p></AdminPage>;
}
