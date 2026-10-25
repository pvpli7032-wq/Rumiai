'use client';
import {useEffect,useState} from 'react';
import {useAuth} from '@web/lib/auth-context';
import {DISCOVERY_PREFERENCES_CHANGED,type DiscoveryPreferences} from '@rumiai/contracts/discovery';
import { DesignIcon } from '@/components/primitives/design-icon';

export function FilterRow({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: { key: string; label: string }[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  if (!options.length) return null;
  return (
    <div className="flex items-center gap-2">
      <span className="shrink-0 whitespace-nowrap text-sm font-bold text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {options.map((o) => {
          const active = selected.includes(o.key);
          return (
            <button
              key={o.key}
              onClick={() => onToggle(o.key)}
              className={`flex min-h-11 shrink-0 items-center rounded-full px-3 text-sm font-semibold transition-all ${
                active ? 'bg-brand-gradient text-white' : 'border border-border text-foreground dark:border-border'
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function SearchRow({
  query,
  onQueryChange,
  onRandom,
  onSearch,
  preferencesOnly = false,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  onRandom: () => void;
  onSearch: () => void;
  preferencesOnly?: boolean;
}) {
  const {token,user}=useAuth();
  const [preferences,setPreferences]=useState<DiscoveryPreferences>({history:[],hidden:[]});
  const [error,setError]=useState('');
  const [revision,setRevision]=useState(0);
  useEffect(()=>{
    setPreferences({history:[],hidden:[]});setError('');
    if(!token)return;
    const controller=new AbortController();
    fetch('/api/me/discovery-preferences',{headers:{Authorization:'Bearer '+token},signal:controller.signal})
      .then(async r=>{const data=await r.json();if(!r.ok)throw Error(data.error||'搜索偏好读取失败。');return data;})
      .then(data=>{if(!controller.signal.aborted)setPreferences(data);}).catch(e=>{if(!controller.signal.aborted)setError(e.message);});
    return()=>controller.abort();
  },[token,user?.id,revision]);
  useEffect(()=>{const refresh=()=>setRevision(v=>v+1);window.addEventListener(DISCOVERY_PREFERENCES_CHANGED,refresh);return()=>window.removeEventListener(DISCOVERY_PREFERENCES_CHANGED,refresh);},[]);
  async function change(path:string,method:string,body?:unknown){
    if(!token)return;
    try{const r=await fetch(path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();if(!r.ok)throw Error(data.error||'偏好保存失败。');setError('');setRevision(v=>v+1);window.dispatchEvent(new Event(DISCOVERY_PREFERENCES_CHANGED));}
    catch(e){setError(e instanceof Error?e.message:'偏好保存失败。');}
  }
  return <div className="w-full min-w-0">{!preferencesOnly&&<form role="search" onSubmit={event=>{event.preventDefault();onSearch();if(query.trim())void change('/api/me/discovery-preferences','PUT',{query:query.trim()});}} className="flex w-full items-center gap-2">
    <label className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-full border border-border bg-card px-4"><DesignIcon name="ph:magnifying-glass" className="h-5 w-5 shrink-0 text-muted-foreground"/><input type="search" enterKeyHint="search" aria-label="搜索角色" placeholder="搜索角色" value={query} onChange={event=>onQueryChange(event.target.value)} className="min-w-0 w-full bg-transparent py-2.5 text-sm outline-none"/></label>
    <button type="button" aria-label="随机探索角色" onClick={onRandom} className="flex min-h-11 min-w-11 items-center justify-center rounded-full border border-border bg-card text-primary"><DesignIcon name="ph:arrows-clockwise"/></button>
  </form>}
  {(preferences.history.length>0||preferences.hidden.length>0)&&<details className="mt-1"><summary className="min-h-9 cursor-pointer text-xs text-muted-foreground">搜索记录与推荐管理</summary>
  {!query&&preferences.history.length>0&&<div className="mt-2 flex flex-wrap items-center gap-2 text-xs"><span className="text-muted-foreground">最近搜索</span>{preferences.history.map(item=><span key={item.query} className="inline-flex items-center rounded-full bg-muted"><button type="button" onClick={()=>{onQueryChange(item.query);onSearch();}} className="min-h-11 px-3">{item.query}</button><button type="button" aria-label={'删除搜索 '+item.query} onClick={()=>void change('/api/me/discovery-preferences?query='+encodeURIComponent(item.query),'DELETE')} className="min-h-11 px-2">×</button></span>)}<button type="button" onClick={()=>void change('/api/me/discovery-preferences','DELETE')} className="min-h-11 px-2 text-muted-foreground">清空</button></div>}
  {preferences.hidden.length>0&&<details className="mt-2 text-xs text-muted-foreground"><summary className="min-h-8 cursor-pointer">已隐藏 {preferences.hidden.length} 个角色</summary><ul>{preferences.hidden.map(item=><li key={item.id} className="flex items-center justify-between gap-2"><span>{item.name}</span><button type="button" onClick={()=>void change('/api/me/hidden-characters/'+encodeURIComponent(item.id),'DELETE')} className="min-h-11 text-primary">恢复推荐</button></li>)}</ul></details>}
  </details>}
  {error&&<p role="alert" className="mt-2 text-xs text-destructive">{error}<button type="button" onClick={()=>setRevision(v=>v+1)} className="ml-2 underline">重试</button></p>}</div>;
}
