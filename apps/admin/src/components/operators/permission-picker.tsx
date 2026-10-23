'use client';

import {useState} from 'react';
import {Input} from '@rumiai/ui/input';

const GROUPS: Record<string,string> = {admin:'后台管理',accounts:'用户与额度',characters:'角色内容',community:'圈子与社区',site:'站点内容',ai:'AI 服务与成本',payments:'支付商户',moderation:'内容审核',finance:'财务',analytics:'运营分析',growth:'增长奖励',operations:'系统运维',compliance:'注册合规',settings:'设置中心',billing:'计费',mirror:'他眼中的你',disputes:'评理广场',tasks:'后台任务',notifications:'通知'};

/** 权限定义和选择状态仍由角色模块持有，此组件仅负责分类检索。 */
export function PermissionPicker({definitions, excluded, value, onChange, disabled}: {definitions:Record<string,string>;excluded:string[];value:string[];onChange:(value:string[])=>void;disabled?:boolean}) {
  const [query,setQuery]=useState('');
  const needle=query.trim().toLowerCase();
  const entries=Object.entries(definitions).filter(([key,label])=>!excluded.includes(key)&&`${key} ${label} ${GROUPS[key.split('.')[0]]??''}`.toLowerCase().includes(needle));
  const groups=[...new Set(entries.map(([key])=>key.split('.')[0]))];
  return <fieldset disabled={disabled} className="space-y-3">
    <legend className="mb-2 text-sm font-medium">业务权限 · 已选择 {value.length} 项</legend>
    <Input aria-label="搜索业务权限" placeholder="按权限名称、业务模块或技术键搜索" value={query} onChange={event=>setQuery(event.target.value)} />
    <div className="grid items-start gap-3 md:grid-cols-2">
      {groups.map(group=>{
        const items=entries.filter(([key])=>key.split('.')[0]===group);
        return <details key={group} open={needle?true:undefined} className="rounded-xl border border-border bg-card p-3">
          <summary className="text-sm font-medium">{GROUPS[group]??group}<span className="ml-2 text-xs text-muted-foreground">{items.filter(([key])=>value.includes(key)).length}/{items.length}</span></summary>
          <div className="mt-2 space-y-1">{items.map(([key,label])=><label key={key} className="flex min-h-10 items-start gap-2 rounded-lg p-2 text-sm hover:bg-muted"><input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-brand" checked={value.includes(key)} onChange={event=>onChange(event.target.checked?[...value,key]:value.filter(item=>item!==key))}/><span>{label}<span className="block break-all text-xs text-muted-foreground">{key}</span></span></label>)}</div>
        </details>;
      })}
    </div>
    {!entries.length&&<p className="text-sm text-muted-foreground">没有匹配的权限。已选权限不会因搜索而丢失。</p>}
  </fieldset>;
}
